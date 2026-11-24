# Período dos relatórios

Visão geral e Tráfego pago compartilham um período aplicado. Ele fica salvo neste navegador em `jbr-report-period-v1`, sobrevive à navegação e à recarga e também se propaga entre abas. Alterar os campos é uma edição provisória; Aplicar confirma o intervalo para os dois relatórios. O primeiro acesso usa os últimos 30 dias da janela Google disponível. Os filtros de origem/campanha continuam específicos de cada tela.

Todos os indicadores temporais das duas telas usam início e fim inclusivos no fuso da conta. Conversões da ação na Visão geral continuam usando a data da conversão; Tráfego pago usa as conversões da conta por data da interação. Por isso essas duas medidas de conversão não devem ser interpretadas como a mesma métrica. Cliques, impressões e investimento coincidem quando a campanha não é filtrada.

Ao aplicar um período sem cobertura Google, a interface solicita `POST /api/v1/ads/sync`. A rota local valida até 366 dias, rejeita datas futuras, reúne pedidos simultâneos em um único processo e consulta apenas dados Google. O mutex Windows do coletor continua protegendo execuções manuais simultâneas. A interface acompanha o andamento sem bloquear a navegação e atualiza os relatórios após a publicação.

A coleta amplia a cobertura existente em vez de apagá-la. A união das janelas é consultada em blocos contíguos de até 31 dias, sequenciais, sem sobreposição. A publicação permanece atômica; falha da coleta principal preserva os dados anteriores. Relatórios complementares informam indisponibilidade separadamente. A parcela de impressões não é calculada por média entre blocos e fica indisponível em coletas com múltiplos blocos.

Não há coleta ao alternar telas quando a janela já está disponível. Atualizar painel relê os dados locais; se a cobertura necessária estiver ausente, dispara a ampliação descrita acima. A rotina manual `npm run sync:google` preserva a cobertura histórica e a atualiza até o último dia completo. Em caso de falha, a mensagem no painel orienta retomar a coleta manual.

Conferência real de 01/08/2026 a 20/11/2026: 4.332 cliques e R$ 11.119,61 nas duas telas; 1.508 leads conhecidos no período. Esses valores são um registro da verificação e podem mudar em sincronizações futuras.
