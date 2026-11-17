use std::{fs, path::Path, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    relkit_release(&out_dir);
    generate_updater_types(&manifest_dir, &out_dir);
    tauri_build::build();
}

/// relkit ADR 0026：从仓内 proto 副本生成 `relkit.updater.v2` 的 prost 类型和
/// 严格 ProtoJSON（pbjson，不开 ignore_unknown_fields，未知字段即报错）。
fn generate_updater_types(manifest_dir: &Path, out_dir: &Path) {
    let proto_root = manifest_dir.join("proto");
    let proto = proto_root.join("updater/v2/updater.proto");
    println!("cargo:rerun-if-changed={}", proto.display());
    std::env::set_var(
        "PROTOC",
        protoc_bin_vendored::protoc_bin_path().expect("vendored protoc 不可用"),
    );
    let well_known = protoc_bin_vendored::include_path().expect("vendored protoc include 不可用");
    let descriptor = out_dir.join("updater_descriptor.bin");
    prost_build::Config::new()
        .file_descriptor_set_path(&descriptor)
        .compile_well_known_types()
        .extern_path(".google.protobuf", "::pbjson_types")
        .compile_protos(&[&proto], &[&proto_root, &well_known])
        .expect("生成 relkit updater 类型失败");
    let descriptors = fs::read(&descriptor).expect("读取 updater descriptor 失败");
    pbjson_build::Builder::new()
        .register_descriptors(&descriptors)
        .expect("注册 updater descriptor 失败")
        .emit_fields()
        .build(&[".relkit.updater.v2"])
        .expect("生成 relkit updater ProtoJSON 失败");
}

/// 只有发布构建（CI producer）同时给出 bootstrap、releaseCode、渠道与版本；
/// 齐备时把 bootstrap 嵌入二进制，否则写空文件，运行期据此停用更新。
fn relkit_release(out_dir: &Path) {
    for name in [
        "MADU_RELKIT_BOOTSTRAP",
        "MADU_RELEASE_CODE",
        "MADU_RELEASE_VERSION",
        "MADU_RELKIT_CHANNEL",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let bootstrap = std::env::var("MADU_RELKIT_BOOTSTRAP").unwrap_or_default();
    let code = std::env::var("MADU_RELEASE_CODE").unwrap_or_default();
    let version = std::env::var("MADU_RELEASE_VERSION").unwrap_or_default();
    let channel = std::env::var("MADU_RELKIT_CHANNEL").unwrap_or_default();
    let target = out_dir.join("relkit-bootstrap.json");
    if bootstrap.is_empty() && code.is_empty() {
        fs::write(&target, "").expect("写入空 bootstrap 失败");
        return;
    }
    if bootstrap.is_empty() || code.is_empty() {
        panic!("MADU_RELKIT_BOOTSTRAP 与 MADU_RELEASE_CODE 必须同时设置");
    }
    let parsed: i64 = code
        .parse()
        .unwrap_or_else(|_| panic!("MADU_RELEASE_CODE 必须是正整数，当前是 {code}"));
    if parsed <= 0 {
        panic!("MADU_RELEASE_CODE 必须是正整数，当前是 {code}");
    }
    if version.is_empty() {
        panic!("发布构建缺少 MADU_RELEASE_VERSION");
    }
    if channel != "stable" && channel != "dev" {
        panic!("MADU_RELKIT_CHANNEL 只能是 stable 或 dev，当前是 {channel}");
    }
    println!("cargo:rerun-if-changed={bootstrap}");
    let text = fs::read_to_string(&bootstrap)
        .unwrap_or_else(|error| panic!("读取 relkit bootstrap 失败 {bootstrap}：{error}"));
    fs::write(&target, text).expect("写入 relkit bootstrap 失败");
    println!("cargo:rustc-env=MADU_RELEASE_CODE={parsed}");
    println!("cargo:rustc-env=MADU_RELEASE_VERSION={version}");
    println!("cargo:rustc-env=MADU_RELKIT_CHANNEL={channel}");
}
