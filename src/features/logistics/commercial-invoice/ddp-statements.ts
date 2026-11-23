/** DDP fiscal-representation statements. The migration uses these same strings. */
export const DDP_FISCAL_STATEMENTS = [
  {
    id: "4d4f0001-4e57-4a11-8be0-000000000001",
    destinationCountry: "BE",
    priority: 30,
    text: "Goods cleared under customs procedure 40 00, subject to the local reverse charge mechanism, cleared into free circulation by Frictionless Trade Services BV, Vergunningenstraat 15, Oostende, 8400, Global VAT number BE0796546281, Place of discharge (Goods in EU free circulation) Belgium.",
  },
  {
    id: "4d4f0002-4e57-4a11-8be0-000000000002",
    destinationCountry: "LU",
    priority: 30,
    text: "Goods transported under 42 00, Intra community supply under Article 138 of the EU VAT directive, cleared into free circulation by Frictionless Trade Services BV, Vergunningenstraat 15, Oostende, 8400, Global VAT number BE0796546281, Place of discharge (Goods in EU free circulation) Belgium.",
  },
  {
    id: "4d4f0003-4e57-4a11-8be0-000000000003",
    destinationCountry: "NL",
    priority: 30,
    text: "Limited Fiscal Representation Frictionless Trade Services BV Marten Meesweg 25-G, NL-3068 AV Rotterdam, VAT Number NL863876584B02, Reverse Charge, VAT shifted to the customer based on Art. 12.3 Dutch VAT law ({buyerVat})",
  },
  {
    id: "4d4f0004-4e57-4a11-8be0-000000000004",
    destinationCountry: "IE",
    priority: 30,
    text: "Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services Limited, 2nd Floor, 1-2 Victoria Buildings, Haddington Road, Dublin 4, D04 XN23, Ireland",
  },
  {
    id: "4d4f0005-4e57-4a11-8be0-000000000005",
    destinationCountry: "FR",
    priority: 30,
    text: "Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services SAS, 70 Rue Mollien, 62100 Calais, France",
  },
  {
    id: "4d4f0006-4e57-4a11-8be0-000000000006",
    destinationCountry: "EU",
    priority: 10,
    text: "Shipped by carrier – Europa Road\nCleared into EU Free Circulation by:\nFrictionless Trade Services SAS\n70 Rue Mollien\n62100 Calais, France\nGlobal VAT No: FRZS 8888 63388 (this VAT number is only applicable if the exporter is not VAT registered in France)\nPlace of discharge (Goods in EU Free Circulation): France\nGoods transported under Regime 42-00, Intra community supply.\nArticle 138 EU VAT Directive",
  },
] as const;
