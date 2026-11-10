/*
 * Assembly x64 da Caju (convenção de chamada do Windows x64).
 *
 * caju_ffi_x64: chama uma função de DLL com N argumentos de 64 bits. Os 4 primeiros
 * vão em RCX, RDX, R8, R9 e, ao mesmo tempo, em XMM0–XMM3: a função lê o registrador
 * que corresponde ao tipo de cada parâmetro. Do 5º em diante, vão na pilha.
 *
 * caju_slot_N (só na DLL): os 64 pontos de entrada exportados. Cada um guarda seu número
 * e salta para caju_x64_common, que salva os argumentos e chama caju_dispatch (em Rust).
 */
  .text

/* void caju_ffi_x64(void *fn, const uint64_t *args, uint64_t n, uint64_t out[2]) */
  .globl caju_ffi_x64
caju_ffi_x64:
  pushq %rbp
  movq %rsp, %rbp
  subq $16, %rsp
  movq %r9, -8(%rbp)          /* out */
  movq %rcx, %r10             /* fn */
  movq %rdx, %r11             /* args */
  movq %r8, %rax
  subq $4, %rax               /* argumentos que vão na pilha */
  jge 1f
  xorl %eax, %eax
1:
  leaq 32(,%rax,8), %rcx      /* 32 bytes de "shadow space" + 8 por argumento */
  addq $15, %rcx
  andq $-16, %rcx
  subq %rcx, %rsp
  xorl %ecx, %ecx
2:
  cmpq %rax, %rcx
  jge 3f
  movq 32(%r11,%rcx,8), %rdx
  movq %rdx, 32(%rsp,%rcx,8)
  incq %rcx
  jmp 2b
3:
  movq 0(%r11), %rcx
  movq 8(%r11), %rdx
  movq 16(%r11), %r8
  movq 24(%r11), %r9
  movq %rcx, %xmm0
  movq %rdx, %xmm1
  movq %r8, %xmm2
  movq %r9, %xmm3
  call *%r10
  movq -8(%rbp), %r9
  movq %rax, 0(%r9)
  movq %xmm0, 8(%r9)
  movq %rbp, %rsp
  popq %rbp
  ret

#ifdef CAJU_DLL
/* Entrada comum dos thunks. Na chegada: EAX = número do thunk, [RSP] = retorno,
   [RSP+8..+40) = espaço reservado pelo chamador para os 4 registradores,
   [RSP+40..) = argumentos do 5º em diante. */
  .globl caju_x64_common
caju_x64_common:
  movq %rcx, 8(%rsp)
  movq %rdx, 16(%rsp)
  movq %r8, 24(%rsp)
  movq %r9, 32(%rsp)
  pushq %rbp
  movq %rsp, %rbp
  subq $48, %rsp
  movsd %xmm0, -32(%rbp)
  movsd %xmm1, -24(%rbp)
  movsd %xmm2, -16(%rbp)
  movsd %xmm3, -8(%rbp)
  movl %eax, %ecx             /* número do thunk */
  leaq 16(%rbp), %rdx         /* argumentos inteiros e da pilha, em sequência */
  leaq -32(%rbp), %r8         /* XMM0–XMM3 */
  leaq -48(%rbp), %r9         /* onde o resultado volta */
  subq $32, %rsp
  call caju_dispatch
  movq -48(%rbp), %rax        /* inteiros e ponteiros */
  movq -48(%rbp), %xmm0       /* f32 e f64 */
  movq %rbp, %rsp
  popq %rbp
  ret

  .globl caju_slot_0
caju_slot_0:
  movl $0, %eax
  jmp caju_x64_common
  .globl caju_slot_1
caju_slot_1:
  movl $1, %eax
  jmp caju_x64_common
  .globl caju_slot_2
caju_slot_2:
  movl $2, %eax
  jmp caju_x64_common
  .globl caju_slot_3
caju_slot_3:
  movl $3, %eax
  jmp caju_x64_common
  .globl caju_slot_4
caju_slot_4:
  movl $4, %eax
  jmp caju_x64_common
  .globl caju_slot_5
caju_slot_5:
  movl $5, %eax
  jmp caju_x64_common
  .globl caju_slot_6
caju_slot_6:
  movl $6, %eax
  jmp caju_x64_common
  .globl caju_slot_7
caju_slot_7:
  movl $7, %eax
  jmp caju_x64_common
  .globl caju_slot_8
caju_slot_8:
  movl $8, %eax
  jmp caju_x64_common
  .globl caju_slot_9
caju_slot_9:
  movl $9, %eax
  jmp caju_x64_common
  .globl caju_slot_10
caju_slot_10:
  movl $10, %eax
  jmp caju_x64_common
  .globl caju_slot_11
caju_slot_11:
  movl $11, %eax
  jmp caju_x64_common
  .globl caju_slot_12
caju_slot_12:
  movl $12, %eax
  jmp caju_x64_common
  .globl caju_slot_13
caju_slot_13:
  movl $13, %eax
  jmp caju_x64_common
  .globl caju_slot_14
caju_slot_14:
  movl $14, %eax
  jmp caju_x64_common
  .globl caju_slot_15
caju_slot_15:
  movl $15, %eax
  jmp caju_x64_common
  .globl caju_slot_16
caju_slot_16:
  movl $16, %eax
  jmp caju_x64_common
  .globl caju_slot_17
caju_slot_17:
  movl $17, %eax
  jmp caju_x64_common
  .globl caju_slot_18
caju_slot_18:
  movl $18, %eax
  jmp caju_x64_common
  .globl caju_slot_19
caju_slot_19:
  movl $19, %eax
  jmp caju_x64_common
  .globl caju_slot_20
caju_slot_20:
  movl $20, %eax
  jmp caju_x64_common
  .globl caju_slot_21
caju_slot_21:
  movl $21, %eax
  jmp caju_x64_common
  .globl caju_slot_22
caju_slot_22:
  movl $22, %eax
  jmp caju_x64_common
  .globl caju_slot_23
caju_slot_23:
  movl $23, %eax
  jmp caju_x64_common
  .globl caju_slot_24
caju_slot_24:
  movl $24, %eax
  jmp caju_x64_common
  .globl caju_slot_25
caju_slot_25:
  movl $25, %eax
  jmp caju_x64_common
  .globl caju_slot_26
caju_slot_26:
  movl $26, %eax
  jmp caju_x64_common
  .globl caju_slot_27
caju_slot_27:
  movl $27, %eax
  jmp caju_x64_common
  .globl caju_slot_28
caju_slot_28:
  movl $28, %eax
  jmp caju_x64_common
  .globl caju_slot_29
caju_slot_29:
  movl $29, %eax
  jmp caju_x64_common
  .globl caju_slot_30
caju_slot_30:
  movl $30, %eax
  jmp caju_x64_common
  .globl caju_slot_31
caju_slot_31:
  movl $31, %eax
  jmp caju_x64_common
  .globl caju_slot_32
caju_slot_32:
  movl $32, %eax
  jmp caju_x64_common
  .globl caju_slot_33
caju_slot_33:
  movl $33, %eax
  jmp caju_x64_common
  .globl caju_slot_34
caju_slot_34:
  movl $34, %eax
  jmp caju_x64_common
  .globl caju_slot_35
caju_slot_35:
  movl $35, %eax
  jmp caju_x64_common
  .globl caju_slot_36
caju_slot_36:
  movl $36, %eax
  jmp caju_x64_common
  .globl caju_slot_37
caju_slot_37:
  movl $37, %eax
  jmp caju_x64_common
  .globl caju_slot_38
caju_slot_38:
  movl $38, %eax
  jmp caju_x64_common
  .globl caju_slot_39
caju_slot_39:
  movl $39, %eax
  jmp caju_x64_common
  .globl caju_slot_40
caju_slot_40:
  movl $40, %eax
  jmp caju_x64_common
  .globl caju_slot_41
caju_slot_41:
  movl $41, %eax
  jmp caju_x64_common
  .globl caju_slot_42
caju_slot_42:
  movl $42, %eax
  jmp caju_x64_common
  .globl caju_slot_43
caju_slot_43:
  movl $43, %eax
  jmp caju_x64_common
  .globl caju_slot_44
caju_slot_44:
  movl $44, %eax
  jmp caju_x64_common
  .globl caju_slot_45
caju_slot_45:
  movl $45, %eax
  jmp caju_x64_common
  .globl caju_slot_46
caju_slot_46:
  movl $46, %eax
  jmp caju_x64_common
  .globl caju_slot_47
caju_slot_47:
  movl $47, %eax
  jmp caju_x64_common
  .globl caju_slot_48
caju_slot_48:
  movl $48, %eax
  jmp caju_x64_common
  .globl caju_slot_49
caju_slot_49:
  movl $49, %eax
  jmp caju_x64_common
  .globl caju_slot_50
caju_slot_50:
  movl $50, %eax
  jmp caju_x64_common
  .globl caju_slot_51
caju_slot_51:
  movl $51, %eax
  jmp caju_x64_common
  .globl caju_slot_52
caju_slot_52:
  movl $52, %eax
  jmp caju_x64_common
  .globl caju_slot_53
caju_slot_53:
  movl $53, %eax
  jmp caju_x64_common
  .globl caju_slot_54
caju_slot_54:
  movl $54, %eax
  jmp caju_x64_common
  .globl caju_slot_55
caju_slot_55:
  movl $55, %eax
  jmp caju_x64_common
  .globl caju_slot_56
caju_slot_56:
  movl $56, %eax
  jmp caju_x64_common
  .globl caju_slot_57
caju_slot_57:
  movl $57, %eax
  jmp caju_x64_common
  .globl caju_slot_58
caju_slot_58:
  movl $58, %eax
  jmp caju_x64_common
  .globl caju_slot_59
caju_slot_59:
  movl $59, %eax
  jmp caju_x64_common
  .globl caju_slot_60
caju_slot_60:
  movl $60, %eax
  jmp caju_x64_common
  .globl caju_slot_61
caju_slot_61:
  movl $61, %eax
  jmp caju_x64_common
  .globl caju_slot_62
caju_slot_62:
  movl $62, %eax
  jmp caju_x64_common
  .globl caju_slot_63
caju_slot_63:
  movl $63, %eax
  jmp caju_x64_common

/* Tabela que a página usa para montar as exportações: ela acha esta estrutura pelo
   texto do início, lê os endereços dos thunks e escreve o diretório de exportação
   (com os nomes das funções da Caju) no espaço reservado em "area".
   Layout: magic[16], nslots u32, space u32, slots[64] (ponteiros), caju_last_error, area[12288] */
#ifdef __ELF__
  .section .cajuexp,"a"
#else
  .section .cajuexp,"dr"
#endif
  .balign 16
  .globl caju_exports
caju_exports:
  .ascii "CAJU-EXPORTS-01\0"
  .long 64
  .long 12288
  .quad caju_slot_0
  .quad caju_slot_1
  .quad caju_slot_2
  .quad caju_slot_3
  .quad caju_slot_4
  .quad caju_slot_5
  .quad caju_slot_6
  .quad caju_slot_7
  .quad caju_slot_8
  .quad caju_slot_9
  .quad caju_slot_10
  .quad caju_slot_11
  .quad caju_slot_12
  .quad caju_slot_13
  .quad caju_slot_14
  .quad caju_slot_15
  .quad caju_slot_16
  .quad caju_slot_17
  .quad caju_slot_18
  .quad caju_slot_19
  .quad caju_slot_20
  .quad caju_slot_21
  .quad caju_slot_22
  .quad caju_slot_23
  .quad caju_slot_24
  .quad caju_slot_25
  .quad caju_slot_26
  .quad caju_slot_27
  .quad caju_slot_28
  .quad caju_slot_29
  .quad caju_slot_30
  .quad caju_slot_31
  .quad caju_slot_32
  .quad caju_slot_33
  .quad caju_slot_34
  .quad caju_slot_35
  .quad caju_slot_36
  .quad caju_slot_37
  .quad caju_slot_38
  .quad caju_slot_39
  .quad caju_slot_40
  .quad caju_slot_41
  .quad caju_slot_42
  .quad caju_slot_43
  .quad caju_slot_44
  .quad caju_slot_45
  .quad caju_slot_46
  .quad caju_slot_47
  .quad caju_slot_48
  .quad caju_slot_49
  .quad caju_slot_50
  .quad caju_slot_51
  .quad caju_slot_52
  .quad caju_slot_53
  .quad caju_slot_54
  .quad caju_slot_55
  .quad caju_slot_56
  .quad caju_slot_57
  .quad caju_slot_58
  .quad caju_slot_59
  .quad caju_slot_60
  .quad caju_slot_61
  .quad caju_slot_62
  .quad caju_slot_63
  .quad caju_last_error
  .byte 0xCA, 0x10
  .zero 12286
#endif

#ifdef __ELF__
  .section .note.GNU-stack,"",@progbits
#endif
