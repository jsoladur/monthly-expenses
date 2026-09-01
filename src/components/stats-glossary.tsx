export function GlossaryCard({
  term,
  definition,
  testId,
}: {
  term: string;
  definition: string;
  testId?: string;
}) {
  return (
    <aside
      data-testid={testId}
      className="border-border bg-card flex flex-col gap-1.5 rounded-lg border px-4 py-3"
    >
      <p className="text-primary text-xs font-medium tracking-wide uppercase">{term}</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{definition}</p>
    </aside>
  );
}

export function StatsGlossary({
  title,
  intro,
  groups,
}: {
  title: string;
  intro?: string;
  groups: Array<{
    heading?: string;
    items: Array<{ term: string; definition: string; testId?: string }>;
  }>;
}) {
  return (
    <article data-testid="stats-glossary" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {intro ? (
          <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">{intro}</p>
        ) : null}
      </div>
      {groups.map((group) => (
        <section key={group.heading ?? group.items[0]?.term} className="flex flex-col gap-3">
          {group.heading ? (
            <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {group.heading}
            </h3>
          ) : null}
          <div className="flex flex-col gap-3">
            {group.items.map((item) => (
              <GlossaryCard
                key={item.term}
                term={item.term}
                definition={item.definition}
                testId={item.testId}
              />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
