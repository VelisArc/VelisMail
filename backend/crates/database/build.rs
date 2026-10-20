// Cargo only rebuilds this crate when a *tracked* source file changes. The
// SQLx migrator embeds every file in `migrations/`, but a newly added
// migration does not change any tracked file, so the crate would keep the
// old migration set and the new migration would never run on a server.
//
// Rebuilding whenever the directory changes keeps the embedded migrator in
// sync with the files on disk.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-changed=src");
}
