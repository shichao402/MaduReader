/**
 * 产品版本 x.y.z 的唯一读取处：src-tauri/tauri.conf.json 的 version。
 * package.json 与 src-tauri/Cargo.toml 必须与它一致（发布前由 producer 校验）。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readVersion() {
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
  const version = String(conf.version ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`src-tauri/tauri.conf.json 的 version 不是 x.y.z：${version}`);
  }
  return version;
}

/** 三处版本必须一致，否则安装包、Cargo 与前端显示的版本会对不上。 */
export function assertVersionsAligned() {
  const version = readVersion();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, "src-tauri", "Cargo.toml"), "utf8"))?.[1];
  if (pkg !== version || cargo !== version) {
    throw new Error(`版本不一致：tauri.conf.json ${version}、package.json ${pkg}、Cargo.toml ${cargo}`);
  }
  return version;
}

export function assertTagMatches(tag, version) {
  if (tag !== `v${version}`) {
    throw new Error(`stable 发布的 tag 必须是 v${version}（取自 tauri.conf.json），实际是 ${tag || "<空>"}`);
  }
}
