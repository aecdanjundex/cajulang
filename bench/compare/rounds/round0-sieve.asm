411dbc:  push   rbp
411dbd:  mov    rbp,rsp
411dc0:  sub    rsp,0x30
411dc7:  xor    eax,eax
411dc9:  mov    QWORD PTR [rbp-0x8],rax
411dd0:  mov    eax,0x2
411dd5:  mov    QWORD PTR [rbp-0x18],rax
411ddc:  mov    rax,QWORD PTR [rbp-0x18]
411de3:  push   rax
411de4:  mov    rax,QWORD PTR [rbp+0x10]
411deb:  mov    rcx,rax
411dee:  pop    rax
411def:  cmp    rax,rcx
411df2:  setle  al
411df5:  movzx  eax,al
411df8:  test   rax,rax
411dfb:  setne  al
411dfe:  movzx  eax,al
411e01:  test   rax,rax
411e04:  je     0x411fce
411e0a:  mov    rax,QWORD PTR [rbp+0x18]
411e11:  push   rax
411e12:  mov    rax,QWORD PTR [rbp-0x18]
411e19:  mov    rcx,rax
411e1c:  pop    rax
411e1d:  test   rax,rax
411e20:  jne    0x411e3e
411e26:  lea    rax,[rip+0x2a83]        # 0x4148b0
411e2d:  push   rax
411e2e:  push   rcx
411e2f:  xor    eax,eax
411e31:  push   rax
411e32:  call   0x409870
411e37:  add    rsp,0x18
411e3e:  mov    rdx,QWORD PTR [rax+0x8]
411e45:  cmp    rcx,rdx
411e48:  jb     0x411e64
411e4e:  lea    rax,[rip+0x2a5b]        # 0x4148b0
411e55:  push   rax
411e56:  push   rcx
411e57:  push   rdx
411e58:  call   0x409ae6
411e5d:  add    rsp,0x18
411e64:  mov    rax,QWORD PTR [rax+0x0]
411e6b:  lea    rax,[rax+rcx*8]
411e6f:  mov    rax,QWORD PTR [rax+0x0]
411e76:  test   rax,rax
411e79:  setne  al
411e7c:  movzx  eax,al
411e7f:  xor    rax,0x1
411e83:  test   rax,rax
411e86:  setne  al
411e89:  movzx  eax,al
411e8c:  test   rax,rax
411e8f:  je     0x411fae
411e95:  mov    rax,QWORD PTR [rbp-0x8]
411e9c:  push   rax
411e9d:  mov    eax,0x1
411ea2:  mov    rcx,rax
411ea5:  pop    rax
411ea6:  add    rax,rcx
411ea9:  mov    QWORD PTR [rbp-0x8],rax
411eb0:  mov    rax,QWORD PTR [rbp-0x18]
411eb7:  push   rax
411eb8:  mov    rax,QWORD PTR [rbp-0x18]
411ebf:  mov    rcx,rax
411ec2:  pop    rax
411ec3:  imul   rax,rcx
411ec7:  mov    QWORD PTR [rbp-0x10],rax
411ece:  mov    rax,QWORD PTR [rbp-0x10]
411ed5:  push   rax
411ed6:  mov    rax,QWORD PTR [rbp+0x10]
411edd:  mov    rcx,rax
411ee0:  pop    rax
411ee1:  cmp    rax,rcx
411ee4:  setle  al
411ee7:  movzx  eax,al
411eea:  test   rax,rax
411eed:  setne  al
411ef0:  movzx  eax,al
411ef3:  test   rax,rax
411ef6:  je     0x411fae
411efc:  mov    rax,QWORD PTR [rbp+0x18]
411f03:  push   rax
411f04:  mov    rax,QWORD PTR [rbp-0x10]
411f0b:  mov    rcx,rax
411f0e:  pop    rax
411f0f:  test   rax,rax
411f12:  jne    0x411f33
411f18:  lea    rax,[rip+0x29b9]        # 0x4148d8
411f1f:  push   rax
411f20:  push   rcx
411f21:  mov    eax,0x1
411f26:  push   rax
411f27:  call   0x409870
411f2c:  add    rsp,0x18
411f33:  mov    rdx,QWORD PTR [rax+0x8]
411f3a:  cmp    rcx,rdx
411f3d:  jb     0x411f59
411f43:  lea    rax,[rip+0x298e]        # 0x4148d8
411f4a:  push   rax
411f4b:  push   rcx
411f4c:  push   rdx
411f4d:  call   0x409ae6
411f52:  add    rsp,0x18
411f59:  mov    rax,QWORD PTR [rax+0x0]
411f60:  lea    rax,[rax+rcx*8]
411f64:  mov    QWORD PTR [rbp-0x20],rax
411f6b:  mov    eax,0x1
411f70:  mov    QWORD PTR [rbp-0x28],rax
411f77:  mov    rax,QWORD PTR [rbp-0x28]
411f7e:  mov    rcx,QWORD PTR [rbp-0x20]
411f85:  mov    QWORD PTR [rcx+0x0],rax
411f8c:  mov    rax,QWORD PTR [rbp-0x10]
411f93:  push   rax
411f94:  mov    rax,QWORD PTR [rbp-0x18]
411f9b:  mov    rcx,rax
411f9e:  pop    rax
411f9f:  add    rax,rcx
411fa2:  mov    QWORD PTR [rbp-0x10],rax
411fa9:  jmp    0x411ece
411fae:  mov    rax,QWORD PTR [rbp-0x18]
411fb5:  push   rax
411fb6:  mov    eax,0x1
411fbb:  mov    rcx,rax
411fbe:  pop    rax
411fbf:  add    rax,rcx
411fc2:  mov    QWORD PTR [rbp-0x18],rax
411fc9:  jmp    0x411ddc
411fce:  mov    rax,QWORD PTR [rbp-0x8]
411fd5:  jmp    0x411fda
411fda:  mov    rsp,rbp
411fdd:  pop    rbp
411fde:  ret
