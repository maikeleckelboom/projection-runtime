use electron_rust_warm_authority::process::{run_stdio, ProcessConfig};
use std::env;
use std::process;

fn main() {
    let config = match ProcessConfig::from_args(env::args().skip(1)) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            process::exit(2);
        }
    };

    if let Err(error) = run_stdio(config) {
        eprintln!("{error}");
        process::exit(1);
    }
}
