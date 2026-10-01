use std::path::Path;

fn main() {
    // The phone page is compiled into the exe (see web.rs). `include_dir!`
    // refuses to build if the folder does not exist at all, which would make
    // a fresh clone fail with an error about a path rather than about the
    // missing `npm run build`. An empty folder compiles; the host then says
    // at runtime that the page is missing, in its own window, in words.
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../client/dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(&dist);
    }
    // The installer bundles everything in `drivers/` (tauri.conf.json), and
    // Tauri refuses to build -- even a plain `cargo build` -- if a bundled
    // path is missing. The ViGEmBus installer itself is only downloaded for
    // release builds (Package-Release.ps1, CI), so make sure the folder at
    // least exists for everyone else.
    let drivers = Path::new(env!("CARGO_MANIFEST_DIR")).join("drivers");
    let readme = drivers.join("README.txt");
    if !readme.exists() {
        let _ = std::fs::create_dir_all(&drivers);
        let _ = std::fs::write(
            &readme,
            "Put the ViGEmBus installer here as ViGEmBus_Setup.exe to bundle it with the\r\n\
             Windows installer. Package-Release.ps1 and the CI build download it for you.\r\n",
        );
    }

    // A directory here is scanned recursively by cargo, so rebuilding the
    // client is enough to have the next host build embed the new bundle.
    println!("cargo:rerun-if-changed=../../client/dist");

    tauri_build::build()
}
