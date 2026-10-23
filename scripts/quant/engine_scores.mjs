// Puntúa filas de factores con el motor técnico de la app (score-engine.js), para comparar en las
// pruebas retrospectivas el motor actual con el modelo entrenado. Entrada: JSON por línea; salida: puntuación por línea.
import "../../score-engine.js";
import readline from "node:readline";
const engine = globalThis.ViewInvAIScore;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const out = [];
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  out.push(engine.technical(r).score);
  if (out.length >= 5000) { process.stdout.write(out.join("\n") + "\n"); out.length = 0; }
}
if (out.length) process.stdout.write(out.join("\n") + "\n");
