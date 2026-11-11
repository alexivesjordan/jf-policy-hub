import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { ServiceQuoteResult, ServiceSitePrices } from "./engine";

export type ProposalSource = {
  customer: string;
  quoteNumber: string;
  sites: { name: string; address: string; prices: ServiceSitePrices }[];
  portfolioPm: ServiceQuoteResult["portfolioPm"];
};

function pounds(value: number | null) {
  if (value == null) return "Confirm scope";
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function cell(text: string, bold = false) {
  return new TableCell({
    width: { size: 3000, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text, bold, font: "Calibri", size: 18 })] })],
  });
}

/** Customer DOCX. No internal rates, margins, or flags. */
export async function buildServiceProposal(result: ProposalSource): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: "PROVISIONAL", bold: true, font: "Calibri", size: 20, color: "CE0037" })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Warranty & Preventative Maintenance Options", font: "Calibri" })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Prepared for ${result.customer}  |  Source quote/order ${result.quoteNumber}  |  All prices exclude VAT`,
          font: "Calibri",
          size: 18,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Indicative proposal — subject to final commercial approval, access review, product identification and confirmation of extended-warranty component eligibility.",
          italics: true,
          font: "Calibri",
          size: 18,
        }),
      ],
    }),
  ];

  for (const site of result.sites) {
    const prices = site.prices;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: site.name }));
    children.push(new Paragraph({ children: [new TextRun({ text: site.address, font: "Calibri", size: 18 })] }));
    const rows: [string, string, string][] = [
      ["Standard Warranty & Aftercare", "Included", "Manufacturer/Jordan applicable product and component cover, remote diagnosis and claims support"],
      ["Annual Preventative Maintenance", prices.hasPmScope ? `${pounds(prices.annualPm)}/year` : "Scope review required", "One planned visit and written report"],
      ["Twice-Yearly Preventative Maintenance", prices.hasPmScope ? `${pounds(prices.twiceYearlyPm)}/year` : "Scope review required", "Two planned visits and written reports"],
      ["Five-Year Extended Component Warranty", prices.hasWarrantyScope ? `${pounds(prices.extendedWarrantyOneOff)} one-off` : "Eligibility review required", "Eligible mechanical/electronic components only; up to the 5th anniversary from delivery"],
    ];
    if (prices.annualBundleYear1 != null && prices.twiceBundleYear1 != null) {
      rows.push(
        ["Annual PM + 5-Year Component Warranty", `${pounds(prices.annualBundleYear1)} in Year 1`, "Includes one planned Year 1 visit and the one-off eligible component extension"],
        ["Twice-Yearly PM + 5-Year Component Warranty", `${pounds(prices.twiceBundleYear1)} in Year 1`, "Includes two Year 1 visits and the one-off eligible component extension"],
      );
    }
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [
        new TableRow({ children: [cell("Service", true), cell("Price", true), cell("Summary", true)] }),
        ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
      ],
    }));
  }

  if (result.portfolioPm) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `If every site takes the same maintenance plan: annual ${pounds(result.portfolioPm.annualPmAllSites)}/year, or twice-yearly ${pounds(result.portfolioPm.twiceYearlyPmAllSites)}/year. The extended warranty is priced separately.`,
        font: "Calibri",
        size: 18,
      })],
    }));
  }

  const prose = [
    "Each planned maintenance visit includes functional and operational safety checks of serviceable fixed strength and cardio assets; checks of frames, fasteners, guards, cables, belts, pulleys, bearings, guide rods and adjusters where fitted; lubrication and normal adjustment; and a written condition report. Loose free weights and accessories receive a general visual review rather than individual machine servicing.",
    "Standard cover follows the applicable product and component schedule. The optional extension protects eligible parts only up to the fifth anniversary from original delivery; existing longer frame warranties remain unchanged. TFT screens, treadmill running surfaces, consumables, upholstery and other wear items retain their standard terms. Concept2 and other third-party equipment remain under their manufacturer's terms unless a signed Jordan schedule says otherwise. Repair labour and travel beyond the standard labour cover are chargeable unless another agreement includes them.",
    "Routine cleaning, operator inspections and prompt fault reports stay with the customer. The price excludes consumables, non-warranty reactive visits, accidental damage, misuse and unauthorised modifications. Stop using unsafe equipment. Prices assume a normal weekday visit. Preventative maintenance renews annually. The extended warranty is a one-off purchase.",
    "PROVISIONAL. This draft is not a binding variation of the equipment order. Unspecified equipment must be identified before a contract is issued.",
  ];
  for (const paragraph of prose) {
    children.push(new Paragraph({ children: [new TextRun({ text: paragraph, font: "Calibri", size: 18 })] }));
  }

  const document = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(document));
}
