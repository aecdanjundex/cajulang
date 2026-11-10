40b94f:  push   rbp
40b950:  mov    rbp,rsp
40b953:  sub    rsp,0x20
40b95a:  xor    eax,eax
40b95c:  mov    QWORD PTR [rbp-0x8],rax
40b960:  xor    eax,eax
40b962:  mov    QWORD PTR [rbp-0x10],rax
40b966:  xor    eax,eax
40b968:  mov    QWORD PTR [rbp-0x18],rax
40b96c:  mov    rax,QWORD PTR [rbp-0x18]
40b970:  cmp    rax,0x32
40b974:  jge    0x40bad0
40b97a:  mov    rax,QWORD PTR [rbp-0x8]
40b97e:  push   rax
40b97f:  mov    rax,QWORD PTR [rbp-0x8]
40b983:  movq   xmm1,rax
40b988:  pop    rax
40b989:  movq   xmm0,rax
40b98e:  mulsd  xmm0,xmm1
40b992:  movq   rax,xmm0
40b997:  push   rax
40b998:  mov    rax,QWORD PTR [rbp-0x10]
40b99c:  push   rax
40b99d:  mov    rax,QWORD PTR [rbp-0x10]
40b9a1:  movq   xmm1,rax
40b9a6:  pop    rax
40b9a7:  movq   xmm0,rax
40b9ac:  mulsd  xmm0,xmm1
40b9b0:  movq   rax,xmm0
40b9b5:  movq   xmm1,rax
40b9ba:  pop    rax
40b9bb:  movq   xmm0,rax
40b9c0:  addsd  xmm0,xmm1
40b9c4:  movq   rax,xmm0
40b9c9:  push   rax
40b9ca:  movabs rax,0x4010000000000000
  40b9d1:	00 10 40 
40b9d4:  movq   xmm1,rax
40b9d9:  pop    rax
40b9da:  movq   xmm0,rax
40b9df:  ucomisd xmm1,xmm0
40b9e3:  setae  al
40b9e6:  movzx  eax,al
40b9e9:  test   rax,rax
40b9ec:  je     0x40bad0
40b9f2:  mov    rax,QWORD PTR [rbp-0x8]
40b9f6:  push   rax
40b9f7:  mov    rax,QWORD PTR [rbp-0x8]
40b9fb:  movq   xmm1,rax
40ba00:  pop    rax
40ba01:  movq   xmm0,rax
40ba06:  mulsd  xmm0,xmm1
40ba0a:  movq   rax,xmm0
40ba0f:  push   rax
40ba10:  mov    rax,QWORD PTR [rbp-0x10]
40ba14:  push   rax
40ba15:  mov    rax,QWORD PTR [rbp-0x10]
40ba19:  movq   xmm1,rax
40ba1e:  pop    rax
40ba1f:  movq   xmm0,rax
40ba24:  mulsd  xmm0,xmm1
40ba28:  movq   rax,xmm0
40ba2d:  movq   xmm1,rax
40ba32:  pop    rax
40ba33:  movq   xmm0,rax
40ba38:  subsd  xmm0,xmm1
40ba3c:  movq   rax,xmm0
40ba41:  push   rax
40ba42:  mov    rax,QWORD PTR [rbp+0x18]
40ba46:  movq   xmm1,rax
40ba4b:  pop    rax
40ba4c:  movq   xmm0,rax
40ba51:  addsd  xmm0,xmm1
40ba55:  movq   rax,xmm0
40ba5a:  mov    QWORD PTR [rbp-0x20],rax
40ba5e:  movabs rax,0x4000000000000000
  40ba65:	00 00 40 
40ba68:  push   rax
40ba69:  mov    rax,QWORD PTR [rbp-0x8]
40ba6d:  movq   xmm1,rax
40ba72:  pop    rax
40ba73:  movq   xmm0,rax
40ba78:  mulsd  xmm0,xmm1
40ba7c:  movq   rax,xmm0
40ba81:  push   rax
40ba82:  mov    rax,QWORD PTR [rbp-0x10]
40ba86:  movq   xmm1,rax
40ba8b:  pop    rax
40ba8c:  movq   xmm0,rax
40ba91:  mulsd  xmm0,xmm1
40ba95:  movq   rax,xmm0
40ba9a:  push   rax
40ba9b:  mov    rax,QWORD PTR [rbp+0x10]
40ba9f:  movq   xmm1,rax
40baa4:  pop    rax
40baa5:  movq   xmm0,rax
40baaa:  addsd  xmm0,xmm1
40baae:  movq   rax,xmm0
40bab3:  mov    QWORD PTR [rbp-0x10],rax
40bab7:  mov    rax,QWORD PTR [rbp-0x20]
40babb:  mov    QWORD PTR [rbp-0x8],rax
40babf:  mov    rax,QWORD PTR [rbp-0x18]
40bac3:  add    rax,0x1
40bac7:  mov    QWORD PTR [rbp-0x18],rax
40bacb:  jmp    0x40b96c
40bad0:  mov    rax,QWORD PTR [rbp-0x18]
40bad4:  jmp    0x40bad9
40bad9:  mov    rsp,rbp
40badc:  pop    rbp
40badd:  ret
