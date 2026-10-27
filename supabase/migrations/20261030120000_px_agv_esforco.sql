-- PX Monitorias & Feedbacks — roteiro AGV de esforço negocial (dashboards "Esforço negocial AGV" por carteira).
-- 5 critérios de esforço negocial + 6 itens do roteiro AGV dos primeiros segundos, lidos da transcrição completa,
-- com evidência por item e material de feedback por ligação. Pode ser executado mais de uma vez.

alter table public.px_criteria drop constraint if exists px_criteria_product_check;
alter table public.px_criteria add constraint px_criteria_product_check
  check (product in ('REFIN','ENTREGA','AMBOS','VEICULOS','SEM_GARANTIA','CARTOES','CONSIGNADO','AGV','AGV2'));

insert into public.px_criteria (product, code, name, description, weight, critical, sort, stage)
select v.product, v.code, v.name, v.description, v.weight, false, v.sort, v.stage
from (values
  ('AGV2', 'SND', 'Sondagem', 'Perguntou o motivo do atraso e quanto ou quando o cliente consegue pagar. Se o cliente contou sozinho e o operador ouviu, vale. Exemplo: "O que aconteceu para atrasar? E quanto o senhor consegue pagar até amanhã?"', 1, 1, 'Esforço negocial'),
  ('AGV2', 'VDV', 'Valor da dívida', 'Informou o valor atualizado. Na quitação, mostrou o saldo junto com o valor com desconto. Exemplo: "Hoje o saldo está em R$ X. Para quitação, consigo liberar R$ Y."', 1, 2, 'Esforço negocial'),
  ('AGV2', 'ESC', 'Escada de ofertas', 'Desceu a escada conforme o cliente: quitação, parcelas em atraso, parcela mais atrasada, uma parte até amanhã. Exemplo: "Se a quitação não cabe, consigo gerar só a parcela mais atrasada para amanhã."', 1, 3, 'Esforço negocial'),
  ('AGV2', 'APN', 'Após o primeiro não', 'Depois da recusa, trouxe outra opção em vez de encerrar. Não se aplica quando o cliente aceitou a primeira oferta. Exemplo: "Entendo. Então vamos ver outra forma: qual valor cabe até amanhã?"', 1, 4, 'Esforço negocial'),
  ('AGV2', 'CSQ', 'Consequências', 'Ao encerrar sem acordo, avisou com calma: juros e ligações continuam, nome negativado, risco de busca e apreensão. Exemplo: "Sem o pagamento, os juros continuam e o contrato pode ir para busca e apreensão."', 1, 5, 'Esforço negocial'),
  ('AGV2', 'NOM', 'Nome do cliente', 'Chamou o cliente pelo nome logo na abertura. Exemplo: "Bom dia, seu João!"', 1, 6, 'Roteiro AGV'),
  ('AGV2', 'EMP', 'Cita a Paschoalotto', 'Se apresentou como Paschoalotto, assessoria do Banco PAN. Exemplo: "Sou a Ana, da Paschoalotto, assessoria do Banco PAN."', 1, 7, 'Roteiro AGV'),
  ('AGV2', 'GRV', 'Aviso de gravação', 'Avisou que a ligação é gravada. Exemplo: "Essa ligação está sendo gravada, tá bom?"', 1, 8, 'Roteiro AGV'),
  ('AGV2', 'SRV', 'Sem revalidar dados', 'Não pediu de novo CPF ou data de nascimento: a AGV já validou. Exemplo: "Seu João, estou retornando sobre o contrato do seu veículo."', 1, 9, 'Roteiro AGV'),
  ('AGV2', 'OUV', 'Ouviu antes de ofertar', 'Perguntou o motivo ou deixou o cliente contar antes da oferta. Exemplo: "O que aconteceu para atrasar esse mês?"', 1, 10, 'Roteiro AGV'),
  ('AGV2', 'SDS', 'Saldo com saída', 'Passou o valor já com uma saída: desconto, condição ou forma de pagamento. Exemplo: "Hoje está em R$ X, e consigo gerar só a parcela mais atrasada para amanhã."', 1, 11, 'Roteiro AGV')
) as v(product, code, name, description, weight, sort, stage)
where not exists (select 1 from public.px_criteria c where c.product = v.product and c.code = v.code);

notify pgrst, 'reload schema';
