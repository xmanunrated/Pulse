// Keep the multipart request under Vercel Functions' 4.5 MB request-body cap.
export const MAX_FARMER_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_FARMER_IMPORT_ROWS = 5000;

export type CsvTable = { headers: string[]; rows: string[][] };

export function parseCsv(input: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one farmer row.');
  if (rows.length > MAX_FARMER_IMPORT_ROWS + 1) {
    throw new Error(`CSV exceeds the ${MAX_FARMER_IMPORT_ROWS} row limit.`);
  }

  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (new Set(headers).size !== headers.length) throw new Error('CSV has duplicate column headers.');
  const dataRows = rows.slice(1);
  if (dataRows.some((values) => values.length !== headers.length)) {
    throw new Error('CSV rows must have the same number of columns as the header.');
  }
  return { headers, rows: dataRows };
}
