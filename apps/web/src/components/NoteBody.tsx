/**
 * A meeting note rendered the way the tablet page renders it: one written line per line, a
 * dash or bullet kept as a marker with the text hanging beside it, and the writer's own
 * indentation carried for sub-items.
 *
 * Kept deliberately in step with Section.notesBlock in packages/compose — the viewer and the
 * printed page are two renderings of the same ink, and they should not disagree about shape.
 */
/**
 * Markers people actually write: a dash or bullet, "1." , "1)", "1.)", "a)", "b.)".
 * A bare letter followed by a dot is deliberately NOT a marker — "A." starts plenty of
 * sentences — so a letter only counts when it closes with a bracket.
 */
const BULLET = /^([-–—•*·]|\d+\.?\)|\d+\.|[A-Za-z]\.?\))\s*(.*)$/;

const isDash = (marker: string) => /^[-–—•*·]$/.test(marker);

export function NoteBody({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="note-body">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="note-gap" />;
        // Indent follows how far the writer indented (2 spaces ≈ one step), capped at two.
        const lead = /^[ \t]*/.exec(raw)![0].replace(/\t/g, "  ").length;
        const depth = Math.min(Math.floor(lead / 2), 2);
        const bullet = BULLET.exec(line);
        if (bullet?.[2]) {
          return (
            <div key={i} className="note-line note-bullet" style={{ marginLeft: depth * 18 }}>
              <span className="note-marker" aria-hidden>
                {isDash(bullet[1]!) ? "–" : bullet[1]}
              </span>
              <span>{bullet[2]}</span>
            </div>
          );
        }
        return (
          <div key={i} className="note-line" style={{ marginLeft: depth * 18 }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
