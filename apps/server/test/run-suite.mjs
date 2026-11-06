// 服务端测试都是「先起服务、再连端口」的端到端脚本，不是 node --test 用例：
// 这里负责按组的起停服务、错开端口，并把每个脚本的退出码汇总。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, "../src/server.mjs");
const PORT_BASE = Number(process.env.PORT_BASE || 8190);

const GROUPS = [
  {
    name: "fake-clock",
    env: { SALEM_FAKE_CLOCK: "1", DAWN_MS: "4000" },
    scripts: ["smoke.mjs", "lifecycle.mjs", "profile.mjs", "bots_add.mjs", "deal.mjs", "reveal.mjs", "offline.mjs"],
  },
  { name: "real-clock", env: {}, scripts: ["resync.mjs", "fullgame_bots.mjs"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(port) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/health");
      if (res.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

function run(script, port, extraEnv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(here, script)], {
      env: { ...process.env, ...extraEnv, PORT: String(port), BASE: "http://127.0.0.1:" + port },
      stdio: "inherit",
    });
    child.on("exit", (code) => done(code ?? 1));
  });
}

const failures = [];
for (const [index, group] of GROUPS.entries()) {
  const port = PORT_BASE + index;
  const srv = spawn(process.execPath, [server], {
    env: { ...process.env, ...group.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    if (!(await waitHealthy(port))) {
      failures.push(group.name + ": server did not become healthy on " + port);
      continue;
    }
    for (const script of group.scripts) {
      const code = await run(script, port, group.env);
      console.log((code === 0 ? "ok   " : "FAIL ") + group.name + " " + script);
      if (code !== 0) failures.push(group.name + " " + script);
    }
  } finally {
    srv.kill();
  }
}

if (failures.length) {
  console.error("\n服务端测试失败：" + failures.join(", "));
  process.exit(1);
}
console.log("\n服务端测试全部通过（" + GROUPS.reduce((n, g) => n + g.scripts.length, 0) + " 个脚本）");
