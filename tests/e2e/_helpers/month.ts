import type postgres from "postgres";

// Insert a month and clone the user's active templates into month_fixed_line
// (same snapshot UC-06 createMonth performs).
export async function insertMonthCloningTemplates(
  sql: postgres.Sql,
  userId: string,
  year: number,
  month: number,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO month (user_id, year, month)
    VALUES (${userId}, ${year}, ${month})
    RETURNING id
  `;
  if (!row) throw new Error("insertMonthCloningTemplates: month insert returned no row");

  await sql`
    INSERT INTO month_fixed_line (
      month_id,
      category_id,
      name,
      observations,
      remaining_amount,
      original_amount,
      kind,
      origin
    )
    SELECT
      ${row.id},
      template.category_id,
      template.name,
      template.observations,
      template.amount,
      template.amount,
      template.kind,
      'cloned'
    FROM template
    WHERE template.user_id = ${userId} AND template.active = true
  `;

  return row.id;
}
