/** "Galaxy S23 Ultra | s23 ultra, s23u" a line: the model, then what sellers type for it. */
export function readModelLines(text: string) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name = "", aliases = ""] = line.split("|");
      return { name: name.trim().slice(0, 60), aliases: aliases.split(",").map(alias => alias.trim().slice(0, 40)).filter(Boolean).slice(0, 20) };
    })
    .filter(model => model.name);
}
