// Renders the Homebrew formula for one release from the archives the release
// workflow built, named hunker-<tag>-<target>.tar.gz:
//   bun scripts/homebrew-formula.ts v0.1.0 dist > Formula/hunker.rb
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repository = "sharno/hunker";

// Homebrew `on_<os>` / `on_<cpu>` blocks and the Rust target built for each.
const targets = {
  macos: { arm: "aarch64-apple-darwin", intel: "x86_64-apple-darwin" },
  linux: {
    arm: "aarch64-unknown-linux-gnu",
    intel: "x86_64-unknown-linux-gnu",
  },
} as const;

const [argument, directory] = process.argv.slice(2);
const version = /^v(\d+\.\d+\.\d+)$/.exec(argument ?? "")?.[1];
if (version === undefined || directory === undefined) {
  console.error(
    "Usage: bun scripts/homebrew-formula.ts vX.Y.Z <archive directory>",
  );
  process.exit(1);
}
const tag = `v${version}`;

const archive = (target: string) => `hunker-${tag}-${target}.tar.gz`;

const download = (target: string) =>
  [
    `url "https://github.com/${repository}/releases/download/${tag}/${archive(target)}"`,
    `sha256 "${createHash("sha256")
      .update(readFileSync(join(directory, archive(target))))
      .digest("hex")}"`,
  ].join("\n      ");

const platforms = Object.entries(targets)
  .map(
    ([os, cpus]) =>
      `  on_${os} do\n${Object.entries(cpus)
        .map(
          ([cpu, target]) =>
            `    on_${cpu} do\n      ${download(target)}\n    end`,
        )
        .join("\n")}\n  end`,
  )
  .join("\n\n");

process.stdout.write(`class Hunker < Formula
  desc "Local GitHub pull-request and Git diff reviewer"
  homepage "https://github.com/${repository}"

${platforms}

  def install
    bin.install "hunker"
    pkgshare.install "extension"
  end

  # Chrome remembers an unpacked extension by its resolved path, so keep a copy
  # outside the versioned Cellar that upgrades refresh in place.
  post_install_steps do
    remove "hunker/extension", base: :var, recursive: true
    copy "extension", "hunker/extension", source_base: :pkgshare, target_base: :var, recursive: true
  end

  def caveats
    <<~EOS
      Run \`hunker\` or \`brew services start hunker\`, then open
      http://127.0.0.1:5173. Private repositories use GITHUB_TOKEN or \`gh auth\`.

      To open GitHub links in Hunker, load its Chrome extension: turn on
      Developer mode in chrome://extensions, choose Load unpacked, and pick
        #{var}/hunker/extension
    EOS
  end

  service do
    run opt_bin/"hunker"
    keep_alive true
    environment_variables PATH: std_service_path_env
    log_path var/"log/hunker.log"
    error_log_path var/"log/hunker.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/hunker --version")
    assert_path_exists pkgshare/"extension/manifest.json"

    port = free_port
    pid = spawn({ "HUNKER_PORT" => port.to_s, "HUNKER_CONFIG_FILE" => (testpath/"settings.json").to_s },
                bin/"hunker")
    begin
      sleep 2
      assert_match "<title>Hunker", shell_output("curl -s http://127.0.0.1:#{port}/")
      assert_match '"application":"hunker"', shell_output("curl -s http://127.0.0.1:#{port}/api/about")
    ensure
      Process.kill("TERM", pid)
      Process.wait(pid)
    end
  end
end
`);
