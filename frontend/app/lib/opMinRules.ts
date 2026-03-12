export type RegraOpMinRow = {
  continuidade: string;
  linha: string;
  grupo: string;
  op_min_ref: number;
  cobertura_max: number;
};

const CONTINUIDADES = ['PERMANENTE', 'PERMANENTE COR NOVA'] as const;
const LINHAS_BASE = ['CONTROL', 'ANATOMIC', 'CLASSIC', 'T.MAIORES', 'MATERNITY'] as const;

function buildRows(
  continuidades: readonly string[],
  linhas: readonly string[],
  grupo: string,
  op_min_ref: number,
  cobertura_max: number
): RegraOpMinRow[] {
  const rows: RegraOpMinRow[] = [];
  for (const continuidade of continuidades) {
    for (const linha of linhas) {
      rows.push({ continuidade, linha, grupo, op_min_ref, cobertura_max });
    }
  }
  return rows;
}

export const OP_MIN_REGRAS_FIXAS: RegraOpMinRow[] = [
  ...buildRows(CONTINUIDADES, LINHAS_BASE, 'CALCA', 320, 6),
  ...buildRows(CONTINUIDADES, LINHAS_BASE, 'SUTIA', 210, 6),
  ...buildRows(CONTINUIDADES, ['IDEAL'], 'SUTIA', 210, 6),
  ...buildRows(CONTINUIDADES, LINHAS_BASE, '<> SUTIA E <> CALCA', 220, 6),
  ...buildRows(CONTINUIDADES, ['<> CONTROL', '<> ANATOMIC', '<> CLASSIC', '<> T.MAIORES', '<> MATERNITY'], 'CALCA', 640, 3),
  ...buildRows(CONTINUIDADES, ['<> CONTROL', '<> ANATOMIC', '<> CLASSIC', '<> T.MAIORES', '<> MATERNITY'], 'SUTIA', 420, 3),
  ...buildRows(CONTINUIDADES, ['<> CONTROL', '<> ANATOMIC', '<> CLASSIC', '<> T.MAIORES', '<> MATERNITY'], '<> SUTIA E <> CALCA', 280, 3),
];
