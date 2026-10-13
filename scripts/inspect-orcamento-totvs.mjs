import "dotenv/config";
import pg from "pg";
import fs from "node:fs";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || "").replace(/^"|"$/g, ""),
  ssl: String(process.env.DB_SSL || "").toLowerCase() === "true"
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true" }
    : undefined,
});

async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

try {
  if (process.argv.includes("lote-fcpfl020")) {
    const rows = await q(`
      SELECT c.seqgrupo,
             c.cor,
             c.descricao AS descricao_mp,
             c.valor_necessidade_total,
             d.iddespesa::INT AS iddespesa,
             d.desc_mp AS descricao_despesa
      FROM public.app_mp_cadastro c
      INNER JOIN public.app_mp_despesa d
        ON d.seqgrupo = c.seqgrupo
       AND d.cor = c.cor
      WHERE c.valor_necessidade_total > 0
        AND d.iddespesa IS NOT NULL
      ORDER BY d.desc_mp, d.iddespesa
    `);
    const unicos = new Set(rows.map((row) => row.iddespesa));
    const nomes = new Set(rows.map((row) => String(row.descricao_despesa || "").trim().toUpperCase()));
    console.log("LOTE_FCPFL020_RESUMO");
    console.table([{
      linhas: rows.length,
      despesas_unicas: unicos.size,
      nomes_unicos: nomes.size,
      sem_descricao: rows.filter((row) => !String(row.descricao_despesa || "").trim()).length,
    }]);
    console.log("AMOSTRA_20");
    console.table(rows.slice(0, 20));
    process.exit(0);
  }

  if (process.argv.includes("ids-despesas-orcamento")) {
    const rows = await q(`
      SELECT DISTINCT iddespesa::INT AS id
      FROM public.app_mp_despesa
      WHERE iddespesa IS NOT NULL
      ORDER BY 1
    `);
    console.log(`TOTAL_CODIGOS_UNICOS ${rows.length}`);
    console.log(rows.map((row) => row.id).join(","));
    process.exit(0);
  }

  if (process.argv.includes("cadastro-mp")) {
    const queries = [
      ["APP_MP_CADASTRO_COLS", `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_mp_cadastro'
        ORDER BY ordinal_position
      `],
      ["APP_MP_CADASTRO_COUNT", `
        SELECT COUNT(*)::INT AS total
        FROM public.app_mp_cadastro
      `],
      ["APP_MP_CADASTRO_SAMPLE", `
        SELECT *
        FROM public.app_mp_cadastro
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 20
      `],
    ];

    for (const [label, sql] of queries) {
      let rows;
      try {
        rows = await q(sql);
      } catch (error) {
        rows = [{ erro: error.message }];
      }
      console.log(label);
      console.table(rows);
    }
    process.exit(0);
  }

  if (process.argv.includes("schema-app-mp-despesa")) {
    const rows = await q(`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_mp_despesa'
      ORDER BY ordinal_position
    `);
    console.log("APP_MP_DESPESA_SCHEMA");
    console.table(rows);
    const constraints = await q(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.app_mp_despesa'::regclass
      ORDER BY conname
    `);
    console.log("APP_MP_DESPESA_CONSTRAINTS");
    console.table(constraints);
    process.exit(0);
  }

  if (process.argv.includes("pendencias-despesa")) {
    const rows = await q(`
      SELECT seqgrupo, cor, iddespesa, desc_mp, status, erro, data_atualizacao
      FROM public.app_mp_despesa
      WHERE status = 'ERRO'
      ORDER BY data_atualizacao DESC, seqgrupo, cor
    `);
    console.log("PENDENCIAS_DESPESA_TOTVS");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("despesas-por-codigos")) {
    const codigos = process.argv
      .slice(process.argv.indexOf("despesas-por-codigos") + 1)
      .map((value) => Number(value))
      .filter(Number.isFinite);
    const rows = codigos.length ? await q(`
      SELECT cd_despesaitem, ds_despesaitem, ds_original, pr_rateio,
             tp_custodespesa, tp_fixovariavel, tp_diretoindireto,
             tp_ccusto, in_padrao, in_bloqueada
      FROM public.vr_fcp_despesaitem
      WHERE cd_despesaitem = ANY($1::INT[])
      ORDER BY cd_despesaitem
    `, [codigos]) : [];
    console.log("DESPESAS_POR_CODIGOS");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("stats-despesas")) {
    const rows = await q(`
      SELECT 'app_mp_despesa' AS origem,
             MIN(iddespesa)::INT AS min_id,
             MAX(iddespesa)::INT AS max_id,
             COUNT(*) FILTER (WHERE iddespesa IS NOT NULL)::INT AS total
      FROM public.app_mp_despesa
      UNION ALL
      SELECT 'vr_fcp_despesaitem' AS origem,
             MIN(cd_despesaitem)::INT AS min_id,
             MAX(cd_despesaitem)::INT AS max_id,
             COUNT(*)::INT AS total
      FROM public.vr_fcp_despesaitem
    `);
    console.log("STATS_DESPESAS");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("ajustar-faixa-app-mp-despesa")) {
    await q(`
      ALTER TABLE public.app_mp_despesa
      DROP CONSTRAINT IF EXISTS ck_app_mp_despesa_faixa
    `);
    await q(`
      ALTER TABLE public.app_mp_despesa
      ADD CONSTRAINT ck_app_mp_despesa_faixa
      CHECK (iddespesa IS NULL OR iddespesa >= 1)
    `);
    const rows = await q(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.app_mp_despesa'::regclass
        AND conname = 'ck_app_mp_despesa_faixa'
    `);
    console.log("CONSTRAINT_AJUSTADA");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("diagnostico-mp-despesa")) {
    const cacheRows = await q(`
      SELECT payload
      FROM public.app_orcamento_mp_cache
      WHERE cache_key = 'orcamento_mp_liebe'
      LIMIT 1
    `);
    const payload = cacheRows[0]?.payload || {};
    const rowsBase = Array.isArray(payload.rowsBase) ? payload.rowsBase : [];
    const priceOptionsByMp = payload.priceOptionsByMp || {};
    const planoAte = "QU";
    const periodos = ["MA", "PX", "UL", "QT", "QU"];
    const artigosSemCusto = new Set(["ALCA", "ALÇA"]);

    const num = (value) => Number(value || 0);
    const valorPeriodo = (row, prefixo, periodo) => num(row[`${prefixo}_${periodo.toLowerCase()}`]);
    const somaAte = (row, prefixo) => periodos
      .slice(0, periodos.indexOf(planoAte) + 1)
      .reduce((acc, periodo) => acc + valorPeriodo(row, prefixo, periodo), 0);
    const saldoAte = (row) => num(row[`saldo_${planoAte.toLowerCase()}`]);
    const ultimaCompra = (row) => {
      const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
        .filter((item) => num(item.quantidade) > 0 && num(item.valor) > 0)
        .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
      const item = compras[0];
      return item ? num(item.valor) / num(item.quantidade || 1) : 0;
    };
    const valorUnitario = (row) => {
      if (artigosSemCusto.has(String(row.artigo || "").trim().toUpperCase())) return 0;
      const fator = num(row.fator_conversao) || 1;
      const ultima = ultimaCompra(row);
      if (ultima > 0) return fator > 1 ? ultima / fator : ultima;
      const preco = num(priceOptionsByMp[String(row.idmateriaprima || "").trim()]?.[0]?.value);
      return fator > 1 ? preco / fator : preco;
    };
    const calcular = (row) => {
      const preco = valorUnitario(row);
      const consumoAte = somaAte(row, "consumo");
      const comprasTotal = num(row.entrada_andamento);
      const necessidadeRegra = Math.max(0, -saldoAte(row));
      const necessidadeTotal = Math.max(0, consumoAte - num(row.estoquetotal) - comprasTotal);
      const valorNecessidade = necessidadeTotal * preco;
      const folga = valorNecessidade <= 0 ? 0 : Math.max(valorNecessidade * 0.05, 250);
      return {
        preco,
        consumoAte,
        comprasTotal,
        necessidadeRegra,
        necessidadeTotal,
        valorNecessidade,
        valorOrcamento: valorNecessidade + folga,
      };
    };

    const linhasComValor = rowsBase
      .map((row) => ({ row, calc: calcular(row) }))
      .filter(({ calc }) => calc.valorOrcamento > 0);

    const ids = [...new Set(linhasComValor.map(({ row }) => String(row.idmateriaprima || "").trim()).filter(Boolean))];
    const refs = [...new Set(linhasComValor.map(({ row }) => String(row.referencia || "").trim()).filter(Boolean))];

    const produtoDespesaRows = ids.length
      ? await q(`
          SELECT p.cd_produto::TEXT AS idmateriaprima,
                 p.cd_despesaitem::INT AS cd_despesaitem,
                 p.cd_ccusto::INT AS cd_ccusto,
                 d.ds_despesaitem
          FROM public.vr_prd_prddesp p
          LEFT JOIN public.vr_fcp_despesaitem d ON d.cd_despesaitem = p.cd_despesaitem
          WHERE p.cd_produto::TEXT = ANY($1::TEXT[])
        `, [ids])
      : [];
    const produtoDespesa = new Map();
    for (const row of produtoDespesaRows) {
      if (!produtoDespesa.has(row.idmateriaprima)) produtoDespesa.set(row.idmateriaprima, []);
      produtoDespesa.get(row.idmateriaprima).push(row);
    }

    const appDespesaRows = refs.length
      ? await q(`
          SELECT seqgrupo::TEXT AS referencia,
                 cor::TEXT AS cor,
                 iddespesa::INT AS cd_despesaitem,
                 desc_mp,
                 status,
                 erro
          FROM public.app_mp_despesa
          WHERE seqgrupo::TEXT = ANY($1::TEXT[])
        `, [refs])
      : [];
    const appDespesa = new Map();
    for (const row of appDespesaRows) {
      appDespesa.set(`${row.referencia}::${row.cor}`, row);
    }

    const resumo = {
      rowsBase: rowsBase.length,
      linhasComValor: linhasComValor.length,
      valorOrcamentoTotal: 0,
      comVinculoProduto: 0,
      semVinculoProduto: 0,
      comCentro502: 0,
      comCentro506: 0,
      outroCentro: 0,
      comAppRefCor: 0,
      semAppRefCor: 0,
      conflitoProdutoVsApp: 0,
    };
    const problemas = [];

    for (const { row, calc } of linhasComValor) {
      const id = String(row.idmateriaprima || "").trim();
      const referencia = String(row.referencia || "").trim();
      const cor = String(row.cor || "").trim();
      const artigo = String(row.artigo || "").trim();
      const desc = String(row.nome_materiaprima || "").trim();
      const vinculosProduto = produtoDespesa.get(id) || [];
      const app = appDespesa.get(`${referencia}::${cor}`) || null;
      resumo.valorOrcamentoTotal += calc.valorOrcamento;
      if (vinculosProduto.length) resumo.comVinculoProduto += 1;
      else resumo.semVinculoProduto += 1;
      if (vinculosProduto.some((v) => Number(v.cd_ccusto) === 502)) resumo.comCentro502 += 1;
      else if (vinculosProduto.some((v) => Number(v.cd_ccusto) === 506)) resumo.comCentro506 += 1;
      else if (vinculosProduto.length) resumo.outroCentro += 1;
      if (app) resumo.comAppRefCor += 1;
      else resumo.semAppRefCor += 1;
      if (
        app &&
        vinculosProduto.length &&
        !vinculosProduto.some((v) => Number(v.cd_despesaitem) === Number(app.cd_despesaitem))
      ) {
        resumo.conflitoProdutoVsApp += 1;
      }

      if (!vinculosProduto.length || !app || (vinculosProduto.length && !vinculosProduto.some((v) => Number(v.cd_ccusto) === 502))) {
        problemas.push({
          idmateriaprima: id,
          referencia,
          cor,
          artigo,
          descricao: desc,
          valor_orcamento: Math.round(calc.valorOrcamento * 100) / 100,
          despesa_produto: vinculosProduto.map((v) => `${v.cd_despesaitem}/${v.cd_ccusto} ${v.ds_despesaitem || ""}`).join(" | ") || null,
          despesa_app_ref_cor: app ? `${app.cd_despesaitem} ${app.status || ""} ${app.desc_mp || ""}` : null,
        });
      }
    }

    console.log("DIAGNOSTICO_RESUMO");
    console.table([{
      ...resumo,
      valorOrcamentoTotal: Math.round(resumo.valorOrcamentoTotal * 100) / 100,
    }]);
    console.log("PROBLEMAS_TOP_50");
    console.table(problemas.sort((a, b) => b.valor_orcamento - a.valor_orcamento).slice(0, 50));
    process.exit(0);
  }

  if (process.argv.includes("diagnostico-mp-cadastro-despesa")) {
    const cacheRows = await q(`
      SELECT payload
      FROM public.app_orcamento_mp_cache
      WHERE cache_key = 'orcamento_mp_liebe'
      LIMIT 1
    `);
    const payload = cacheRows[0]?.payload || {};
    const rowsBase = Array.isArray(payload.rowsBase) ? payload.rowsBase : [];
    const priceOptionsByMp = payload.priceOptionsByMp || {};
    const planoAte = "QU";
    const periodos = ["MA", "PX", "UL", "QT", "QU"];
    const artigosSemCusto = new Set(["ALCA", "ALÇA"]);

    const num = (value) => Number(value || 0);
    const valorPeriodo = (row, prefixo, periodo) => num(row[`${prefixo}_${periodo.toLowerCase()}`]);
    const somaAte = (row, prefixo) => periodos
      .slice(0, periodos.indexOf(planoAte) + 1)
      .reduce((acc, periodo) => acc + valorPeriodo(row, prefixo, periodo), 0);
    const ultimaCompra = (row) => {
      const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
        .filter((item) => num(item.quantidade) > 0 && num(item.valor) > 0)
        .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
      const item = compras[0];
      return item ? num(item.valor) / num(item.quantidade || 1) : 0;
    };
    const valorUnitario = (row) => {
      if (artigosSemCusto.has(String(row.artigo || "").trim().toUpperCase())) return 0;
      const fator = num(row.fator_conversao) || 1;
      const ultima = ultimaCompra(row);
      if (ultima > 0) return fator > 1 ? ultima / fator : ultima;
      const preco = num(priceOptionsByMp[String(row.idmateriaprima || "").trim()]?.[0]?.value);
      return fator > 1 ? preco / fator : preco;
    };
    const calcular = (row) => {
      const preco = valorUnitario(row);
      const consumoAte = somaAte(row, "consumo");
      const comprasTotal = num(row.entrada_andamento);
      const necessidadeTotal = Math.max(0, consumoAte - num(row.estoquetotal) - comprasTotal);
      const valorNecessidade = necessidadeTotal * preco;
      const folga = valorNecessidade <= 0 ? 0 : Math.max(valorNecessidade * 0.05, 250);
      return { valorOrcamento: valorNecessidade + folga };
    };

    const linhasComValor = rowsBase
      .map((row) => ({ row, calc: calcular(row) }))
      .filter(({ calc }) => calc.valorOrcamento > 0);
    const ids = [...new Set(linhasComValor.map(({ row }) => String(row.idmateriaprima || "").trim()).filter(Boolean))];

    const gradeRows = ids.length
      ? await q(`
          SELECT cd_produto::TEXT AS idmateriaprima,
                 cd_seqgrupo::TEXT AS seqgrupo,
                 TRIM(cd_cor)::TEXT AS cd_cor,
                 ds_cor::TEXT AS ds_cor,
                 nm_produto::TEXT AS nm_produto
          FROM public.vr_prd_prdgrade
          WHERE cd_produto::TEXT = ANY($1::TEXT[])
        `, [ids])
      : [];
    const gradeByProduto = new Map(gradeRows.map((row) => [row.idmateriaprima, row]));

    const keys = [...new Set(gradeRows.map((row) => `${row.seqgrupo}::${row.cd_cor}`))];
    const seqs = [...new Set(gradeRows.map((row) => row.seqgrupo).filter(Boolean))];
    const cors = [...new Set(gradeRows.map((row) => row.cd_cor).filter(Boolean))];

    const cadastroRows = keys.length
      ? await q(`
          SELECT seqgrupo::TEXT, cor::TEXT, descricao, necessidade_total, valor_necessidade_total
          FROM public.app_mp_cadastro
          WHERE seqgrupo::TEXT = ANY($1::TEXT[])
            AND cor::TEXT = ANY($2::TEXT[])
        `, [seqs, cors])
      : [];
    const cadastro = new Map(cadastroRows.map((row) => [`${row.seqgrupo}::${row.cor}`, row]));

    const despesaRows = keys.length
      ? await q(`
          SELECT a.seqgrupo::TEXT,
                 a.cor::TEXT,
                 a.iddespesa::INT AS cd_despesaitem,
                 a.desc_mp,
                 a.status,
                 a.erro,
                 f.ds_despesaitem
          FROM public.app_mp_despesa a
          LEFT JOIN public.vr_fcp_despesaitem f ON f.cd_despesaitem = a.iddespesa
          WHERE a.seqgrupo::TEXT = ANY($1::TEXT[])
            AND a.cor::TEXT = ANY($2::TEXT[])
        `, [seqs, cors])
      : [];
    const despesa = new Map(despesaRows.map((row) => [`${row.seqgrupo}::${row.cor}`, row]));

    const resumo = {
      linhasComValor: linhasComValor.length,
      valorOrcamentoTotal: 0,
      comGrade: 0,
      semGrade: 0,
      comCadastro: 0,
      semCadastro: 0,
      comDespesa: 0,
      semDespesa: 0,
      comCadastroSemDespesa: 0,
      comDespesaSemCadastro: 0,
    };
    const problemas = [];
    const porArtigo = new Map();
    const loteFcpfl020 = [];

    for (const { row, calc } of linhasComValor) {
      const id = String(row.idmateriaprima || "").trim();
      const artigo = String(row.artigo || "-").trim() || "-";
      const grade = gradeByProduto.get(id);
      const key = grade ? `${grade.seqgrupo}::${grade.cd_cor}` : "";
      const cad = key ? cadastro.get(key) : null;
      const desp = key ? despesa.get(key) : null;
      resumo.valorOrcamentoTotal += calc.valorOrcamento;
      if (grade) resumo.comGrade += 1;
      else resumo.semGrade += 1;
      if (cad) resumo.comCadastro += 1;
      else resumo.semCadastro += 1;
      if (desp) resumo.comDespesa += 1;
      else resumo.semDespesa += 1;
      if (cad && !desp) resumo.comCadastroSemDespesa += 1;
      if (desp && !cad) resumo.comDespesaSemCadastro += 1;

      if (grade && cad && desp) {
        loteFcpfl020.push({
          idmateriaprima: id,
          seqgrupo: grade.seqgrupo,
          cor: grade.cd_cor,
          iddespesa: desp.cd_despesaitem,
          descricao: String(desp.ds_despesaitem || desp.desc_mp || "").trim(),
        });
      }

      const art = porArtigo.get(artigo) || { artigo, linhas: 0, valor: 0, semDespesa: 0 };
      art.linhas += 1;
      art.valor += calc.valorOrcamento;
      if (!desp) art.semDespesa += 1;
      porArtigo.set(artigo, art);

      if (!grade || !cad || !desp) {
        problemas.push({
          idmateriaprima: id,
          seqgrupo: grade?.seqgrupo || null,
          cd_cor: grade?.cd_cor || null,
          ds_cor: grade?.ds_cor || row.cor || null,
          artigo,
          descricao: String(row.nome_materiaprima || grade?.nm_produto || "").trim(),
          valor_orcamento: Math.round(calc.valorOrcamento * 100) / 100,
          cadastro: cad ? `${cad.necessidade_total} / ${cad.valor_necessidade_total}` : null,
          despesa: desp ? `${desp.cd_despesaitem} ${desp.ds_despesaitem || ""}` : null,
          status: desp?.status || null,
        });
      }
    }

    console.log("DIAGNOSTICO_CADASTRO_DESPESA_RESUMO");
    console.table([{ ...resumo, valorOrcamentoTotal: Math.round(resumo.valorOrcamentoTotal * 100) / 100 }]);
    console.log("POR_ARTIGO");
    console.table(Array.from(porArtigo.values()).map((row) => ({
      ...row,
      valor: Math.round(row.valor * 100) / 100,
    })).sort((a, b) => b.valor - a.valor));
    console.log("PROBLEMAS_TOP_80");
    console.table(problemas.sort((a, b) => b.valor_orcamento - a.valor_orcamento).slice(0, 80));
    if (process.argv.includes("exportar-lote-fcpfl020")) {
      if (loteFcpfl020.length !== linhasComValor.length || loteFcpfl020.some((item) => !item.descricao)) {
        throw new Error("lote incompleto ou com descricao ausente; exportacao interrompida");
      }
      const arquivo = ".agents/totvs_agent_minimo/data/lote-fcpfl020-painel.json";
      fs.mkdirSync(".agents/totvs_agent_minimo/data", { recursive: true });
      fs.writeFileSync(arquivo, JSON.stringify(loteFcpfl020, null, 2) + "\n", "utf8");
      console.log(`LOTE_EXPORTADO ${arquivo} itens=${loteFcpfl020.length}`);
      console.log(`CONTEM_DESPESA_397 ${loteFcpfl020.some((item) => item.iddespesa === 397)}`);
    }
    process.exit(0);
  }

  if (process.argv.includes("sugerir-despesas-faltantes")) {
    const faltantes = await q(`
      WITH base AS (
        SELECT
          c.seqgrupo,
          c.cor,
          c.descricao,
          c.necessidade_total,
          c.valor_necessidade_total
        FROM public.app_mp_cadastro c
        LEFT JOIN public.app_mp_despesa d
          ON d.seqgrupo = c.seqgrupo
         AND d.cor = c.cor
        WHERE d.seqgrupo IS NULL
          AND COALESCE(c.valor_necessidade_total, 0) > 0
      )
      SELECT *
      FROM base
      ORDER BY valor_necessidade_total DESC
      LIMIT 50
    `);

    const candidatos = [];
    for (const item of faltantes) {
      const tokens = String(item.descricao || "")
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
        .slice(0, 4);
      const likeParams = tokens.map((token) => `%${token}%`);
      let rows = [];
      if (likeParams.length) {
        const where = likeParams.map((_, index) => `UPPER(desc_mp) LIKE $${index + 1}`).join(" AND ");
        rows = await q(`
          SELECT
            seqgrupo,
            cor,
            iddespesa,
            desc_mp,
            status,
            COUNT(*) OVER (PARTITION BY iddespesa) AS freq_mesma_despesa
          FROM public.app_mp_despesa
          WHERE ${where}
          ORDER BY freq_mesma_despesa DESC, seqgrupo, cor
          LIMIT 10
        `, likeParams);
      }
      candidatos.push({
        ...item,
        tokens: tokens.join(" "),
        candidatos: rows.map((row) => `${row.iddespesa} | ${row.seqgrupo}/${row.cor} | ${row.desc_mp}`).join(" || ") || null,
      });
    }

    console.log("FALTANTES_COM_CANDIDATOS");
    console.table(candidatos);

    const porDespesa = await q(`
      SELECT
        iddespesa,
        COUNT(*)::INT AS qtd,
        MIN(desc_mp) AS exemplo
      FROM public.app_mp_despesa
      WHERE status = 'OK'
      GROUP BY iddespesa
      ORDER BY qtd DESC
      LIMIT 80
    `);
    console.log("DESPESAS_MAIS_USADAS");
    console.table(porDespesa);
    process.exit(0);
  }

  if (process.argv.includes("buscar-fcp-faltantes")) {
    const faltantes = await q(`
      SELECT
        c.seqgrupo,
        c.cor,
        c.descricao,
        c.necessidade_total,
        c.valor_necessidade_total
      FROM public.app_mp_cadastro c
      LEFT JOIN public.app_mp_despesa d
        ON d.seqgrupo = c.seqgrupo
       AND d.cor = c.cor
      WHERE d.seqgrupo IS NULL
        AND COALESCE(c.valor_necessidade_total, 0) > 0
      ORDER BY c.valor_necessidade_total DESC
    `);

    const rows = [];
    for (const item of faltantes) {
      const descricao = String(item.descricao || "").trim();
      const semUnidade = descricao.replace(/\s+U$/i, "").trim();
      const tokens = semUnidade
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
        .slice(0, 5);
      const exact = await q(`
        SELECT cd_despesaitem, ds_despesaitem, ds_original, in_bloqueada
        FROM public.vr_fcp_despesaitem
        WHERE UPPER(TRIM(ds_despesaitem)) IN (UPPER(TRIM($1)), UPPER(TRIM($2)))
           OR UPPER(TRIM(ds_original)) IN (UPPER(TRIM($1)), UPPER(TRIM($2)))
        ORDER BY cd_despesaitem DESC
        LIMIT 5
      `, [descricao, semUnidade]);

      let fuzzy = [];
      if (!exact.length && tokens.length) {
        const where = tokens.map((_, index) => `(UPPER(ds_despesaitem) LIKE $${index + 1} OR UPPER(ds_original) LIKE $${index + 1})`).join(" AND ");
        fuzzy = await q(`
          SELECT cd_despesaitem, ds_despesaitem, ds_original, in_bloqueada
          FROM public.vr_fcp_despesaitem
          WHERE ${where}
          ORDER BY cd_despesaitem DESC
          LIMIT 10
        `, tokens.map((token) => `%${token}%`));
      }

      rows.push({
        seqgrupo: item.seqgrupo,
        cor: item.cor,
        descricao,
        valor_necessidade_total: item.valor_necessidade_total,
        exato: exact.map((row) => `${row.cd_despesaitem} | ${row.ds_despesaitem}`).join(" || ") || null,
        aproximado: fuzzy.map((row) => `${row.cd_despesaitem} | ${row.ds_despesaitem}`).join(" || ") || null,
      });
    }

    console.log("FCP_FALTANTES");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("inserir-pendencias-despesa")) {
    const result = await q(`
      INSERT INTO public.app_mp_despesa (
        seqgrupo,
        cor,
        iddespesa,
        desc_mp,
        data_atualizacao,
        status,
        erro
      )
      SELECT
        c.seqgrupo,
        c.cor,
        NULL::INTEGER AS iddespesa,
        c.descricao AS desc_mp,
        NOW() AS data_atualizacao,
        'ERRO' AS status,
        'Pendente criar/relacionar despesa no TOTVS pelo componente de despesas' AS erro
      FROM public.app_mp_cadastro c
      LEFT JOIN public.app_mp_despesa d
        ON d.seqgrupo = c.seqgrupo
       AND d.cor = c.cor
      WHERE d.seqgrupo IS NULL
        AND COALESCE(c.valor_necessidade_total, 0) > 0
      RETURNING seqgrupo, cor, iddespesa, desc_mp, status, erro
    `);

    console.log("PENDENCIAS_INSERIDAS");
    console.table(result);
    process.exit(0);
  }

  if (process.argv.includes("marcar-despesa-ok")) {
    const args = process.argv.slice(process.argv.indexOf("marcar-despesa-ok") + 1);
    const [seqgrupo, cor, iddespesaRaw] = args;
    const iddespesa = Number(iddespesaRaw);
    if (!seqgrupo || !cor || !Number.isFinite(iddespesa)) {
      throw new Error("uso: marcar-despesa-ok <seqgrupo> <cor> <iddespesa>");
    }
    const rows = await q(`
      UPDATE public.app_mp_despesa
         SET iddespesa = $3,
             status = 'OK',
             erro = 'Criado no TOTVS; aguardar sincronizacao do ERP no minuto 45 para validar em vr_fcp_despesaitem',
             data_atualizacao = NOW()
       WHERE seqgrupo = $1
         AND cor = $2
       RETURNING seqgrupo, cor, iddespesa, desc_mp, status, erro, data_atualizacao
    `, [seqgrupo, cor, iddespesa]);
    console.log("DESPESA_ATUALIZADA");
    console.table(rows);
    process.exit(0);
  }

  if (process.argv.includes("focus")) {
    const focusQueries = [
      ["APP_MP_DESPESA_COUNTS", `
        SELECT
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (WHERE iddespesa IS NOT NULL)::INT AS com_despesa,
          COUNT(*) FILTER (WHERE status IS NOT NULL)::INT AS com_status,
          COUNT(*) FILTER (WHERE erro IS NOT NULL)::INT AS com_erro
        FROM public.app_mp_despesa
      `],
      ["APP_MP_DESPESA_SAMPLE", `
        SELECT seqgrupo, cor, iddespesa, desc_mp, status, erro
        FROM public.app_mp_despesa
        ORDER BY data_atualizacao DESC NULLS LAST
        LIMIT 20
      `],
      ["PEDIDOI_DESP_COLS", `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vr_cmp_pedidoidesp'
        ORDER BY ordinal_position
      `],
      ["PEDIDOI_DESP_SAMPLE", `
        SELECT cd_empresa, cd_pedido, cd_produto, nr_sequencia, cd_despesaitem, nr_seqctaplano, cd_ccusto, pr_rateio, vl_rateio
        FROM public.vr_cmp_pedidoidesp
        ORDER BY dt_cadastro DESC NULLS LAST
        LIMIT 20
      `],
      ["PEDIDO_2026_COM_DESPESA_SAMPLE", `
        SELECT
          i.cd_empresa,
          i.cd_pedido,
          i.cd_produto,
          i.cd_seqgrupo,
          i.ds_ultnivel,
          i.qt_solicitada,
          i.vl_solicitado,
          i.qt_pendente,
          i.vl_pendente,
          i.dt_preventrega,
          d.cd_despesaitem,
          d.cd_ccusto,
          d.pr_rateio,
          d.vl_rateio
        FROM public.vr_cmp_pedidoi i
        LEFT JOIN public.vr_cmp_pedidoidesp d
          ON d.cd_empresa = i.cd_empresa
         AND d.cd_pedido = i.cd_pedido
         AND d.cd_produto = i.cd_produto
        WHERE i.dt_preventrega >= DATE '2026-01-01'
          AND i.dt_preventrega < DATE '2027-01-01'
        ORDER BY i.dt_preventrega DESC NULLS LAST
        LIMIT 30
      `],
      ["ORCAMENTO_VALORES_2026_SAMPLE", `
        SELECT cd_ccusto, cd_despesaitem, ano, mes, valor_orcado
        FROM public.orcamento_valores
        WHERE ano = 2026
        ORDER BY cd_despesaitem, cd_ccusto, mes
        LIMIT 30
      `],
      ["ORCAMENTO_VS_PEDIDO_AGR_2026", `
        WITH pedidos AS (
          SELECT
            COALESCE(d.cd_despesaitem, c.cd_despesaitem)::INT AS cd_despesaitem,
            COALESCE(d.cd_ccusto, c.cd_ccusto)::INT AS cd_ccusto,
            EXTRACT(MONTH FROM i.dt_preventrega)::INT AS mes,
            SUM(COALESCE(i.vl_pendente, 0))::NUMERIC(15,2) AS vl_pendente,
            SUM(COALESCE(i.vl_atendido, 0))::NUMERIC(15,2) AS vl_atendido,
            SUM(COALESCE(i.vl_solicitado, 0))::NUMERIC(15,2) AS vl_solicitado
          FROM public.vr_cmp_pedidoi i
          LEFT JOIN public.vr_cmp_pedidoidesp d
            ON d.cd_empresa = i.cd_empresa
           AND d.cd_pedido = i.cd_pedido
           AND d.cd_produto = i.cd_produto
          LEFT JOIN public.vr_cmp_pedidocdesp c
            ON c.cd_empresa = i.cd_empresa
           AND c.cd_pedido = i.cd_pedido
          WHERE i.dt_preventrega >= DATE '2026-01-01'
            AND i.dt_preventrega < DATE '2027-01-01'
            AND COALESCE(d.cd_despesaitem, c.cd_despesaitem) IS NOT NULL
            AND COALESCE(d.cd_ccusto, c.cd_ccusto) IS NOT NULL
          GROUP BY 1, 2, 3
        )
        SELECT
          p.cd_despesaitem,
          f.ds_despesaitem,
          p.cd_ccusto,
          p.mes,
          COALESCE(o.valor_orcado, 0)::NUMERIC(15,2) AS valor_orcado,
          p.vl_solicitado,
          p.vl_pendente,
          p.vl_atendido,
          (COALESCE(o.valor_orcado, 0) - p.vl_pendente - p.vl_atendido)::NUMERIC(15,2) AS saldo_pos_comprometido
        FROM pedidos p
        LEFT JOIN public.orcamento_valores o
          ON o.cd_despesaitem = p.cd_despesaitem
         AND o.cd_ccusto = p.cd_ccusto
         AND o.ano = 2026
         AND o.mes = p.mes
        LEFT JOIN public.vr_fcp_despesaitem f
          ON f.cd_despesaitem = p.cd_despesaitem
        ORDER BY ABS(COALESCE(o.valor_orcado, 0) - p.vl_pendente - p.vl_atendido) DESC
        LIMIT 30
      `],
    ];

    for (const [label, sql] of focusQueries) {
      let rows;
      try {
        rows = await q(sql);
      } catch (error) {
        rows = [{ erro: error.message }];
      }
      console.log(label);
      console.table(rows);
    }
    process.exit(0);
  }

  const tables = await q(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (
          LOWER(table_name) LIKE '%orc%' OR
          LOWER(table_name) LIKE '%desp%' OR
          LOWER(table_name) LIKE '%pedido%' OR
          LOWER(table_name) LIKE '%cmp%' OR
          LOWER(table_name) LIKE '%conta%'
        )
      ORDER BY table_name
      LIMIT 120`
  );
  console.log("TABLES");
  console.table(tables);

  const cols = await q(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [[
      "app_orcamento_mp_despesas_totvs",
      "app_orcamento_mp_exportacao",
      "app_mp_despesa",
      "orcamento_valores",
      "vr_cmp_pedidoc2",
      "vr_cmp_pedidocdesp",
      "vr_cmp_pedidoi",
      "vr_cmp_pedidoidesp",
      "vr_fcp_despesaitem",
      "vr_prd_prddesp",
      "vr_prd_fornecedor",
      "vw_app_mp_despesa_pendentes",
      "vw_despesas_abertas",
      "vw_despesas_historico",
    ]]
  );
  console.log("COLUMNS");
  console.table(cols);

  let despesas;
  try {
    despesas = await q(
      `SELECT *
         FROM public.app_orcamento_mp_despesas_totvs
        ORDER BY valor_orcamento DESC
        LIMIT 10`
    );
  } catch (error) {
    despesas = [{ erro: error.message }];
  }
  console.log("DESPESAS_SAMPLE");
  console.table(despesas);

  const sampleQueries = [
    ["APP_MP_DESPESA_SAMPLE", `SELECT * FROM public.app_mp_despesa LIMIT 10`],
    ["PEDIDOI_DESP_FIELDS_SAMPLE", `
      SELECT *
        FROM public.vr_cmp_pedidoidesp
       LIMIT 10
    `],
    ["PEDIDOC_DESP_FIELDS_SAMPLE", `
      SELECT *
        FROM public.vr_cmp_pedidocdesp
       LIMIT 10
    `],
    ["FCP_DESPESAITEM_SAMPLE", `
      SELECT *
        FROM public.vr_fcp_despesaitem
       LIMIT 10
    `],
    ["PRD_PRDDESP_SAMPLE", `
      SELECT *
        FROM public.vr_prd_prddesp
       LIMIT 10
    `],
    ["VW_MP_DESPESA_PENDENTES_SAMPLE", `
      SELECT *
        FROM public.vw_app_mp_despesa_pendentes
       LIMIT 10
    `],
  ];

  for (const [label, sql] of sampleQueries) {
    let rows;
    try {
      rows = await q(sql);
    } catch (error) {
      rows = [{ erro: error.message }];
    }
    console.log(label);
    console.table(rows);
  }
} finally {
  await pool.end();
}
