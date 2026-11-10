//! Runtime nativo da linguagem Caju, em Rust.
//!
//! Este programa é a mesma máquina virtual de pilha que roda no navegador. Sozinho ele não
//! faz nada: o gerador de .exe da página cola o bytecode do programa no fim deste executável,
//! e ao iniciar o runtime lê esse bytecode do próprio arquivo e o executa.
//!
//! Layout do arquivo final:
//!   [runtime] [bytecode] [tamanho u32] ["CAJUEXE1"] [zeros de alinhamento] [assinatura Authenticode]
//! A assinatura é opcional; quando existe, o bytecode é procurado logo antes dela.
//!
//! Com a feature "dll", vira uma DLL: o código de topo do programa roda na primeira chamada
//! (inicialização) e cada função marcada com dllexport é chamada por um "thunk" em assembly
//! (caju-asm-x64.S), cujo nome a página troca pelo nome da função.

mod heap;
mod native;
mod num;
mod prog;
mod vm;

/// Ponto de entrada do .exe (o runtime é ligado como biblioteca estática pelo linker de C)
#[cfg(not(feature = "dll"))]
#[no_mangle]
pub extern "C" fn main(_argc: i32, _argv: *const *const u8) -> i32 {
    native::exe_main()
}
