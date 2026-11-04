//! Measurement-only pre-serialized JSON/Base64 baseline. Not a second runtime.
use std::io::{self, BufRead, Write};
use std::time::Instant;

fn main() {
    let bytes = std::fs::read(std::env::args().nth(1).expect("fixture")).unwrap();
    let start = Instant::now();
    let mut out = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        match line.unwrap().as_str() {
            "read" => out.write_all(&bytes).unwrap(),
            "control" => writeln!(
                out,
                "{{\"control\":true,\"appliedUs\":{}}}",
                start.elapsed().as_micros()
            )
            .unwrap(),
            "quit" => break,
            _ => panic!("invalid command"),
        }
        out.flush().unwrap();
    }
}
