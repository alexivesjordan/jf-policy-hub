-- DDP fiscal-representation statements.
-- Idempotent: a row is skipped when its id already exists, or when an
-- identical active DDP rule already exists for that destination.
-- Does not change the two inactive seeds from 20261121100100.

insert into logistics.customs_statement_rules (
  id, incoterm, destination_country, carrier, statement_text, extra_line, priority, active
)
select v.id, 'DDP', v.destination_country, null, v.statement_text, null, v.priority, true
from (
  values
    (
      '4d4f0001-4e57-4a11-8be0-000000000001'::uuid,
      'BE',
      30,
      $ddp$Goods cleared under customs procedure 40 00, subject to the local reverse charge mechanism, cleared into free circulation by Frictionless Trade Services BV, Vergunningenstraat 15, Oostende, 8400, Global VAT number BE0796546281, Place of discharge (Goods in EU free circulation) Belgium.$ddp$
    ),
    (
      '4d4f0002-4e57-4a11-8be0-000000000002'::uuid,
      'LU',
      30,
      $ddp$Goods transported under 42 00, Intra community supply under Article 138 of the EU VAT directive, cleared into free circulation by Frictionless Trade Services BV, Vergunningenstraat 15, Oostende, 8400, Global VAT number BE0796546281, Place of discharge (Goods in EU free circulation) Belgium.$ddp$
    ),
    (
      '4d4f0003-4e57-4a11-8be0-000000000003'::uuid,
      'NL',
      30,
      $ddp$Limited Fiscal Representation Frictionless Trade Services BV Marten Meesweg 25-G, NL-3068 AV Rotterdam, VAT Number NL863876584B02, Reverse Charge, VAT shifted to the customer based on Art. 12.3 Dutch VAT law ({buyerVat})$ddp$
    ),
    (
      '4d4f0004-4e57-4a11-8be0-000000000004'::uuid,
      'IE',
      30,
      $ddp$Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services Limited, 2nd Floor, 1-2 Victoria Buildings, Haddington Road, Dublin 4, D04 XN23, Ireland$ddp$
    ),
    (
      '4d4f0005-4e57-4a11-8be0-000000000005'::uuid,
      'FR',
      30,
      $ddp$Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services SAS, 70 Rue Mollien, 62100 Calais, France$ddp$
    ),
    (
      '4d4f0006-4e57-4a11-8be0-000000000006'::uuid,
      'EU',
      10,
      $ddp$Shipped by carrier – Europa Road
Cleared into EU Free Circulation by:
Frictionless Trade Services SAS
70 Rue Mollien
62100 Calais, France
Global VAT No: FRZS 8888 63388 (this VAT number is only applicable if the exporter is not VAT registered in France)
Place of discharge (Goods in EU Free Circulation): France
Goods transported under Regime 42-00, Intra community supply.
Article 138 EU VAT Directive$ddp$
    )
) as v(id, destination_country, priority, statement_text)
where not exists (
  select 1
  from logistics.customs_statement_rules existing
  where existing.id = v.id
     or (
       existing.active
       and existing.incoterm = 'DDP'
       and existing.destination_country = v.destination_country
       and existing.carrier is null
       and existing.statement_text = v.statement_text
     )
);
