-- Produtos da carteira Safra BS: Cartões (já existia), Cheque especial/empresarial, Empréstimos,
-- Parcelamento de dívidas, PDD e Adiantamento ao depositante. Pode rodar de novo sem erro.
alter table public.px_evaluations drop constraint if exists px_evaluations_product_check;
alter table public.px_evaluations add constraint px_evaluations_product_check
  check (product in ('REFIN','ENTREGA','VEICULOS','CARTOES','CONSIGNADO','CHEQUE','EMPRESTIMOS','PARCELAMENTO','PDD','ADIANTAMENTO'));
alter table public.px_criteria drop constraint if exists px_criteria_product_check;
alter table public.px_criteria add constraint px_criteria_product_check
  check (product in ('REFIN','ENTREGA','AMBOS','VEICULOS','SEM_GARANTIA','CARTOES','CONSIGNADO','AGV','AGV2','CHEQUE','EMPRESTIMOS','PARCELAMENTO','PDD','ADIANTAMENTO'));
notify pgrst, 'reload schema';
