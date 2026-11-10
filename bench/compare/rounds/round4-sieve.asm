40b83f:  push   rbp
40b840:  mov    rbp,rsp
40b843:  sub    rsp,0x20
40b84a:  xor    eax,eax
40b84c:  mov    QWORD PTR [rbp-0x8],rax
40b850:  mov    eax,0x2
40b855:  mov    QWORD PTR [rbp-0x18],rax
40b859:  mov    rax,QWORD PTR [rbp-0x18]
40b85d:  mov    rcx,QWORD PTR [rbp+0x10]
40b861:  cmp    rax,rcx
40b864:  jg     0x40b96d
40b86a:  mov    rax,QWORD PTR [rbp+0x18]
40b86e:  mov    rcx,QWORD PTR [rbp-0x18]
40b872:  test   rax,rax
40b875:  jne    0x40b890
40b87b:  lea    rax,[rip+0x202e]        # 0x40d8b0
40b882:  push   rax
40b883:  push   rcx
40b884:  xor    eax,eax
40b886:  push   rax
40b887:  call   0x4068a5
40b88c:  add    rsp,0x18
40b890:  mov    rdx,QWORD PTR [rax+0x8]
40b894:  cmp    rcx,rdx
40b897:  jb     0x40b8b0
40b89d:  lea    rax,[rip+0x200c]        # 0x40d8b0
40b8a4:  push   rax
40b8a5:  push   rcx
40b8a6:  push   rdx
40b8a7:  call   0x406a47
40b8ac:  add    rsp,0x18
40b8b0:  mov    rax,QWORD PTR [rax+0x0]
40b8b4:  mov    rax,QWORD PTR [rax+rcx*8]
40b8b8:  test   rax,rax
40b8bb:  jne    0x40b95c
40b8c1:  mov    rax,QWORD PTR [rbp-0x8]
40b8c5:  add    rax,0x1
40b8c9:  mov    QWORD PTR [rbp-0x8],rax
40b8cd:  mov    rax,QWORD PTR [rbp-0x18]
40b8d1:  mov    rcx,QWORD PTR [rbp-0x18]
40b8d5:  imul   rax,rcx
40b8d9:  mov    QWORD PTR [rbp-0x10],rax
40b8dd:  mov    rax,QWORD PTR [rbp-0x10]
40b8e1:  mov    rcx,QWORD PTR [rbp+0x10]
40b8e5:  cmp    rax,rcx
40b8e8:  jg     0x40b95c
40b8ee:  mov    rax,QWORD PTR [rbp+0x18]
40b8f2:  mov    rcx,QWORD PTR [rbp-0x10]
40b8f6:  test   rax,rax
40b8f9:  jne    0x40b917
40b8ff:  lea    rax,[rip+0x1fd2]        # 0x40d8d8
40b906:  push   rax
40b907:  push   rcx
40b908:  mov    eax,0x1
40b90d:  push   rax
40b90e:  call   0x4068a5
40b913:  add    rsp,0x18
40b917:  mov    rdx,QWORD PTR [rax+0x8]
40b91b:  cmp    rcx,rdx
40b91e:  jb     0x40b937
40b924:  lea    rax,[rip+0x1fad]        # 0x40d8d8
40b92b:  push   rax
40b92c:  push   rcx
40b92d:  push   rdx
40b92e:  call   0x406a47
40b933:  add    rsp,0x18
40b937:  mov    rax,QWORD PTR [rax+0x0]
40b93b:  lea    rax,[rax+rcx*8]
40b93f:  mov    ecx,0x1
40b944:  mov    QWORD PTR [rax+0x0],rcx
40b948:  mov    rax,QWORD PTR [rbp-0x10]
40b94c:  mov    rcx,QWORD PTR [rbp-0x18]
40b950:  add    rax,rcx
40b953:  mov    QWORD PTR [rbp-0x10],rax
40b957:  jmp    0x40b8dd
40b95c:  mov    rax,QWORD PTR [rbp-0x18]
40b960:  add    rax,0x1
40b964:  mov    QWORD PTR [rbp-0x18],rax
40b968:  jmp    0x40b859
40b96d:  mov    rax,QWORD PTR [rbp-0x8]
40b971:  jmp    0x40b976
40b976:  mov    rsp,rbp
40b979:  pop    rbp
40b97a:  ret
