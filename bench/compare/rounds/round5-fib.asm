413afe:  push   rbp
413aff:  mov    rbp,rsp
413b02:  sub    rsp,0x0
413b09:  mov    rax,QWORD PTR [rbp+0x10]
413b0d:  cmp    rax,0x2
413b11:  jge    0x413b20
413b17:  mov    rax,QWORD PTR [rbp+0x10]
413b1b:  jmp    0x413ba1
413b20:  mov    rax,QWORD PTR [rbp+0x10]
413b24:  sub    rax,0x1
413b28:  push   rax
413b29:  cmp    r15,0x2710
413b30:  jl     0x413b4b
413b36:  lea    rax,[rip+0x44e3]        # 0x418020
413b3d:  push   rax
413b3e:  lea    rax,[rip+0xf4b]        # 0x414a90
413b45:  push   rax
413b46:  call   0x40bad1
413b4b:  inc    r15
413b4e:  call   0x413afe
413b53:  dec    r15
413b56:  add    rsp,0x8
413b5a:  push   rax
413b5b:  mov    rax,QWORD PTR [rbp+0x10]
413b5f:  sub    rax,0x2
413b63:  push   rax
413b64:  cmp    r15,0x2710
413b6b:  jl     0x413b86
413b71:  lea    rax,[rip+0x44a8]        # 0x418020
413b78:  push   rax
413b79:  lea    rax,[rip+0xf10]        # 0x414a90
413b80:  push   rax
413b81:  call   0x40bad1
413b86:  inc    r15
413b89:  call   0x413afe
413b8e:  dec    r15
413b91:  add    rsp,0x8
413b95:  mov    rcx,rax
413b98:  pop    rax
413b99:  add    rax,rcx
413b9c:  jmp    0x413ba1
413ba1:  mov    rsp,rbp
413ba4:  pop    rbp
413ba5:  ret
