import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  SpreadsheetParseError,
  looksLikeLegacyXls,
  looksLikeXlsx,
  parseCsv,
  parseXlsx,
} from './parse-spreadsheet.js';

describe('parseCsv', () => {
  it('parses plain comma CSV with CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('﻿name,email\nana,a@b.ie')[0]).toEqual(['name', 'email']);
  });

  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    const rows = parseCsv(
      'name,notes\n"Murphy, Sarah","said ""hi""\nand left"\n'
    );
    expect(rows).toEqual([
      ['name', 'notes'],
      ['Murphy, Sarah', 'said "hi"\nand left'],
    ]);
  });

  it('sniffs semicolon delimiters (EU exports)', () => {
    expect(parseCsv('name;email\nana;a@b.ie')).toEqual([
      ['name', 'email'],
      ['ana', 'a@b.ie'],
    ]);
  });

  it('sniffs tab delimiters', () => {
    expect(parseCsv('name\temail\nana\ta@b.ie')).toEqual([
      ['name', 'email'],
      ['ana', 'a@b.ie'],
    ]);
  });

  it('drops fully empty rows', () => {
    expect(parseCsv('a,b\n,\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles bare-CR line endings', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

/** Build a tiny real .xlsx (zip of XML parts) for parser tests. */
function makeXlsx(opts?: {
  shared?: boolean;
  richText?: boolean;
}): Uint8Array {
  const sharedStrings = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>Full Name</t></si>
  <si>${opts?.richText ? '<r><t>Em</t></r><r><t>ail</t></r>' : '<t>Email</t>'}</si>
  <si><t>Sarah Murphy</t></si>
</sst>`;
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>Phone</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="inlineStr"><is><t>sarah@example.ie</t></is></c>
      <c r="C2"><v>876846467</v></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Liam</t></is></c>
      <c r="C3" t="inlineStr"><is><t>0871111111</t></is></c>
    </row>
  </sheetData>
</worksheet>`;
  const workbook = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  if (opts?.shared !== false) {
    files['xl/sharedStrings.xml'] = strToU8(sharedStrings);
  }
  return zipSync(files);
}

describe('parseXlsx', () => {
  it('reads shared strings, inline strings, numbers and sparse cells', () => {
    const rows = parseXlsx(makeXlsx());
    expect(rows).toEqual([
      ['Full Name', 'Email', 'Phone'],
      ['Sarah Murphy', 'sarah@example.ie', '876846467'],
      ['Liam', '', '0871111111'],
    ]);
  });

  it('joins rich-text runs in shared strings', () => {
    const rows = parseXlsx(makeXlsx({ richText: true }));
    expect(rows[0][1]).toBe('Email');
  });

  it('throws a SpreadsheetParseError on a non-zip buffer', () => {
    expect(() => parseXlsx(strToU8('definitely not a zip'))).toThrow(
      SpreadsheetParseError
    );
  });
});

describe('magic-byte sniffing', () => {
  it('detects zip (xlsx) and OLE (legacy xls) headers', () => {
    expect(looksLikeXlsx(makeXlsx())).toBe(true);
    expect(looksLikeXlsx(strToU8('name,email'))).toBe(false);
    expect(
      looksLikeLegacyXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))
    ).toBe(true);
  });
});
