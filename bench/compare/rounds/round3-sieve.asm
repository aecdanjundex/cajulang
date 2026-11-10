40b99e:  push   rbp
40b99f:  mov    rbp,rsp
40b9a2:  sub    rsp,0x20
40b9a9:  xor    eax,eax
40b9ab:  mov    QWORD PTR [rbp-0x8],rax
40b9af:  mov    eax,0x2
40b9b4:  mov    QWORD PTR [rbp-0x18],rax
40b9b8:  mov    rax,QWORD PTR [rbp-0x18]
40b9bc:  mov    rcx,QWORD PTR [rbp+0x10]
40b9c0:  cmp    rax,rcx
40b9c3:  jg     0x40bacc
40b9c9:  mov    rax,QWORD PTR [rbp+0x18]
40b9cd:  mov    rcx,QWORD PTR [rbp-0x18]
40b9d1:  test   rax,rax
40b9d4:  jne    0x40b9ef
40b9da:  lea    rax,[rip+0x1ecf]        # 0x40d8b0
40b9e1:  push   rax
40b9e2:  push   rcx
40b9e3:  xor    eax,eax
40b9e5:  push   rax
40b9e6:  call   0x4069a6
40b9eb:  add    rsp,0x18
40b9ef:  mov    rdx,QWORD PTR [rax+0x8]
40b9f3:  cmp    rcx,rdx
40b9f6:  jb     0x40ba0f
40b9fc:  lea    rax,[rip+0x1ead]        # 0x40d8b0
40ba03:  push   rax
40ba04:  push   rcx
40ba05:  push   rdx
40ba06:  call   0x406b48
40ba0b:  add    rsp,0x18
40ba0f:  mov    rax,QWORD PTR [rax+0x0]
40ba13:  mov    rax,QWORD PTR [rax+rcx*8]
40ba17:  test   rax,rax
40ba1a:  jne    0x40babb
40ba20:  mov    rax,QWORD PTR [rbp-0x8]
40ba24:  add    rax,0x1
40ba28:  mov    QWORD PTR [rbp-0x8],rax
40ba2c:  mov    rax,QWORD PTR [rbp-0x18]
40ba30:  mov    rcx,QWORD PTR [rbp-0x18]
40ba34:  imul   rax,rcx
40ba38:  mov    QWORD PTR [rbp-0x10],rax
40ba3c:  mov    rax,QWORD PTR [rbp-0x10]
40ba40:  mov    rcx,QWORD PTR [rbp+0x10]
40ba44:  cmp    rax,rcx
40ba47:  jg     0x40babb
40ba4d:  mov    rax,QWORD PTR [rbp+0x18]
40ba51:  mov    rcx,QWORD PTR [rbp-0x10]
40ba55:  test   rax,rax
40ba58:  jne    0x40ba76
40ba5e:  lea    rax,[rip+0x1e73]        # 0x40d8d8
40ba65:  push   rax
40ba66:  push   rcx
40ba67:  mov    eax,0x1
40ba6c:  push   rax
40ba6d:  call   0x4069a6
40ba72:  add    rsp,0x18
40ba76:  mov    rdx,QWORD PTR [rax+0x8]
40ba7a:  cmp    rcx,rdx
40ba7d:  jb     0x40ba96
40ba83:  lea    rax,[rip+0x1e4e]        # 0x40d8d8
40ba8a:  push   rax
40ba8b:  push   rcx
40ba8c:  push   rdx
40ba8d:  call   0x406b48
40ba92:  add    rsp,0x18
40ba96:  mov    rax,QWORD PTR [rax+0x0]
40ba9a:  lea    rax,[rax+rcx*8]
40ba9e:  mov    ecx,0x1
40baa3:  mov    QWORD PTR [rax+0x0],rcx
40baa7:  mov    rax,QWORD PTR [rbp-0x10]
40baab:  mov    rcx,QWORD PTR [rbp-0x18]
40baaf:  add    rax,rcx
40bab2:  mov    QWORD PTR [rbp-0x10],rax
40bab6:  jmp    0x40ba3c
40babb:  mov    rax,QWORD PTR [rbp-0x18]
40babf:  add    rax,0x1
40bac3:  mov    QWORD PTR [rbp-0x18],rax
40bac7:  jmp    0x40b9b8
40bacc:  mov    rax,QWORD PTR [rbp-0x8]
40bad0:  jmp    0x40bad5
40bad5:  mov    rsp,rbp
40bad8:  pop    rbp
40bad9:  ret
