'use client';

// A Distribuição sugerida virou um capítulo da aba Capacidade x Plano (18/11/2026): uma tela
// só, com o mesmo plano, a mesma capacidade e a mesma lista. Este endereço continua
// funcionando para links salvos — só leva para a aba.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DistribuicaoSugeridaRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/laboratorio-capacidade#lista');
  }, [router]);
  return <div className="p-8 text-sm text-gray-500">A Distribuição sugerida agora fica na aba Capacidade x Plano. Abrindo…</div>;
}
