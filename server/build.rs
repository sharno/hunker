use std::{env, path::Path, process::Command};

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR");
    let workspace = Path::new(&manifest_dir)
        .parent()
        .expect("server belongs to the Hunker workspace");
    let output = env::var("OUT_DIR").expect("Cargo provides OUT_DIR");
    let output = Path::new(&output);

    println!("cargo:rerun-if-changed={}", workspace.join("elm").display());
    println!(
        "cargo:rerun-if-changed={}",
        workspace.join("elm.json").display()
    );

    run(
        workspace,
        &workspace.join("node_modules/.bin/elm"),
        &[
            "make",
            "elm/src/Main.elm",
            "--optimize",
            "--output",
            output.join("app.js").to_string_lossy().as_ref(),
        ],
        "Elm compiler",
    );
    run(
        workspace,
        &workspace.join("node_modules/.bin/tailwindcss"),
        &[
            "-i",
            "elm/styles.css",
            "-o",
            output.join("app.css").to_string_lossy().as_ref(),
            "--minify",
        ],
        "Tailwind compiler",
    );
}

fn run(workspace: &Path, executable: &Path, arguments: &[&str], name: &str) {
    assert!(
        executable.is_file(),
        "{name} is unavailable at {}. Run `bun install` before building Hunker.",
        executable.display()
    );
    let status = Command::new(executable)
        .args(arguments)
        .current_dir(workspace)
        .status()
        .unwrap_or_else(|error| panic!("Could not start {name}: {error}"));
    assert!(status.success(), "{name} failed with {status}");
}
