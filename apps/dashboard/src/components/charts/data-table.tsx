import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column + row model derived from a chart's data — the §6.19 accessible alternative. */
export type ChartColumn = { key: string; label: string; numeric?: boolean };
export type ChartTableRow = Record<string, string | number>;
export type ChartTableModel = { columns: ChartColumn[]; rows: ChartTableRow[] };

/** Renders a chart's underlying data as a plain table (the "View as table" view). */
export function DataTable({ model }: { model: ChartTableModel }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {model.columns.map((c) => (
            <TableHead key={c.key} className={cn(c.numeric && 'text-right')}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.rows.map((row, i) => (
          <TableRow key={i}>
            {model.columns.map((c) => (
              <TableCell key={c.key} className={cn(c.numeric && 'text-right')}>
                {row[c.key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
