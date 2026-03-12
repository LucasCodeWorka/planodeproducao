export function fatorMesAtualDecorrido(refDate = new Date()) {
  const mesAtual = refDate.getMonth() + 1;
  const diasNoMes = new Date(refDate.getFullYear(), mesAtual, 0).getDate();
  const diaAtual = Math.min(refDate.getDate(), diasNoMes);
  return diasNoMes > 0 ? Math.max(0, Math.min(1, diaAtual / diasNoMes)) : 1;
}

export function fatorMesAtualRestante(refDate = new Date()) {
  const mesAtual = refDate.getMonth() + 1;
  const diasNoMes = new Date(refDate.getFullYear(), mesAtual, 0).getDate();
  const diaAtual = Math.min(refDate.getDate(), diasNoMes);
  return diasNoMes > 0 ? Math.max(0, Math.min(1, (diasNoMes - diaAtual) / diasNoMes)) : 0;
}

export function projecaoMesPlanejamento(valor: number, mes: number, refDate = new Date()) {
  const v = Number(valor || 0);
  const mesAtual = refDate.getMonth() + 1;
  if (mes === mesAtual) return v * fatorMesAtualRestante(refDate);
  return v;
}

export function projecaoMesDecorrida(valor: number, mes: number, refDate = new Date()) {
  const v = Number(valor || 0);
  const mesAtual = refDate.getMonth() + 1;
  if (mes === mesAtual) return v * fatorMesAtualDecorrido(refDate);
  return v;
}
