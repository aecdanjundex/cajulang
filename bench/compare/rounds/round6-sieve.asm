40bc02:  push   rbp
40bc03:  mov    rbp,rsp
40bc06:  sub    rsp,0x40
40bc0d:  mov    QWORD PTR [rbp-0x20],rbx
40bc11:  mov    QWORD PTR [rbp-0x28],r12
40bc15:  mov    QWORD PTR [rbp-0x30],r13
40bc19:  mov    QWORD PTR [rbp-0x38],r14
40bc1d:  mov    r13,QWORD PTR [rbp+0x10]
40bc21:  xor    eax,eax
40bc23:  mov    r14,rax
40bc26:  mov    eax,0x2
40bc2b:  mov    r12,rax
40bc2e:  mov    rax,r12
40bc31:  mov    rcx,r13
40bc34:  cmp    rax,rcx
40bc37:  jg     0x40bd32
40bc3d:  mov    rax,QWORD PTR [rbp+0x18]
40bc41:  mov    rcx,r12
40bc44:  test   rax,rax
40bc47:  jne    0x40bc62
40bc4d:  lea    rax,[rip+0x1c54]        # 0x40d8a8
40bc54:  push   rax
40bc55:  push   rcx
40bc56:  xor    eax,eax
40bc58:  push   rax
40bc59:  call   0x406a55
40bc5e:  add    rsp,0x18
40bc62:  mov    rdx,QWORD PTR [rax+0x8]
40bc66:  cmp    rcx,rdx
40bc69:  jb     0x40bc82
40bc6f:  lea    rax,[rip+0x1c32]        # 0x40d8a8
40bc76:  push   rax
40bc77:  push   rcx
40bc78:  push   rdx
40bc79:  call   0x406c06
40bc7e:  add    rsp,0x18
40bc82:  mov    rax,QWORD PTR [rax+0x0]
40bc86:  mov    rax,QWORD PTR [rax+rcx*8]
40bc8a:  test   rax,rax
40bc8d:  jne    0x40bd23
40bc93:  mov    rax,r14
40bc96:  add    rax,0x1
40bc9a:  mov    r14,rax
40bc9d:  mov    rax,r12
40bca0:  mov    rcx,r12
40bca3:  imul   rax,rcx
40bca7:  mov    rbx,rax
40bcaa:  mov    rax,rbx
40bcad:  mov    rcx,r13
40bcb0:  cmp    rax,rcx
40bcb3:  jg     0x40bd23
40bcb9:  mov    rax,QWORD PTR [rbp+0x18]
40bcbd:  mov    rcx,rbx
40bcc0:  test   rax,rax
40bcc3:  jne    0x40bce1
40bcc9:  lea    rax,[rip+0x1c00]        # 0x40d8d0
40bcd0:  push   rax
40bcd1:  push   rcx
40bcd2:  mov    eax,0x1
40bcd7:  push   rax
40bcd8:  call   0x406a55
40bcdd:  add    rsp,0x18
40bce1:  mov    rdx,QWORD PTR [rax+0x8]
40bce5:  cmp    rcx,rdx
40bce8:  jb     0x40bd01
40bcee:  lea    rax,[rip+0x1bdb]        # 0x40d8d0
40bcf5:  push   rax
40bcf6:  push   rcx
40bcf7:  push   rdx
40bcf8:  call   0x406c06
40bcfd:  add    rsp,0x18
40bd01:  mov    rax,QWORD PTR [rax+0x0]
40bd05:  lea    rax,[rax+rcx*8]
40bd09:  mov    ecx,0x1
40bd0e:  mov    QWORD PTR [rax+0x0],rcx
40bd12:  mov    rax,rbx
40bd15:  mov    rcx,r12
40bd18:  add    rax,rcx
40bd1b:  mov    rbx,rax
40bd1e:  jmp    0x40bcaa
40bd23:  mov    rax,r12
40bd26:  add    rax,0x1
40bd2a:  mov    r12,rax
40bd2d:  jmp    0x40bc2e
40bd32:  mov    rax,r14
40bd35:  jmp    0x40bd3a
40bd3a:  mov    rbx,QWORD PTR [rbp-0x20]
40bd3e:  mov    r12,QWORD PTR [rbp-0x28]
40bd42:  mov    r13,QWORD PTR [rbp-0x30]
40bd46:  mov    r14,QWORD PTR [rbp-0x38]
40bd4a:  mov    rsp,rbp
40bd4d:  pop    rbp
40bd4e:  ret
