40b7f0:  push   rbp
40b7f1:  mov    rbp,rsp
40b7f4:  sub    rsp,0x20
40b7fb:  xor    eax,eax
40b7fd:  mov    QWORD PTR [rbp-0x8],rax
40b801:  xor    eax,eax
40b803:  mov    QWORD PTR [rbp-0x10],rax
40b807:  xor    eax,eax
40b809:  mov    QWORD PTR [rbp-0x18],rax
40b80d:  mov    rax,QWORD PTR [rbp-0x18]
40b811:  cmp    rax,0x32
40b815:  jge    0x40b902
40b81b:  mov    rax,QWORD PTR [rbp-0x8]
40b81f:  movq   xmm0,rax
40b824:  mov    rax,QWORD PTR [rbp-0x8]
40b828:  movq   xmm1,rax
40b82d:  mulsd  xmm0,xmm1
40b831:  mov    rax,QWORD PTR [rbp-0x10]
40b835:  movq   xmm1,rax
40b83a:  mov    rax,QWORD PTR [rbp-0x10]
40b83e:  movq   xmm2,rax
40b843:  mulsd  xmm1,xmm2
40b847:  addsd  xmm0,xmm1
40b84b:  movabs rax,0x4010000000000000
  40b852:	00 10 40 
40b855:  movq   xmm1,rax
40b85a:  ucomisd xmm1,xmm0
40b85e:  jb     0x40b902
40b864:  mov    rax,QWORD PTR [rbp-0x8]
40b868:  movq   xmm0,rax
40b86d:  mov    rax,QWORD PTR [rbp-0x8]
40b871:  movq   xmm1,rax
40b876:  mulsd  xmm0,xmm1
40b87a:  mov    rax,QWORD PTR [rbp-0x10]
40b87e:  movq   xmm1,rax
40b883:  mov    rax,QWORD PTR [rbp-0x10]
40b887:  movq   xmm2,rax
40b88c:  mulsd  xmm1,xmm2
40b890:  subsd  xmm0,xmm1
40b894:  mov    rax,QWORD PTR [rbp+0x18]
40b898:  movq   xmm1,rax
40b89d:  addsd  xmm0,xmm1
40b8a1:  movq   rax,xmm0
40b8a6:  mov    QWORD PTR [rbp-0x20],rax
40b8aa:  movabs rax,0x4000000000000000
  40b8b1:	00 00 40 
40b8b4:  movq   xmm0,rax
40b8b9:  mov    rax,QWORD PTR [rbp-0x8]
40b8bd:  movq   xmm1,rax
40b8c2:  mulsd  xmm0,xmm1
40b8c6:  mov    rax,QWORD PTR [rbp-0x10]
40b8ca:  movq   xmm1,rax
40b8cf:  mulsd  xmm0,xmm1
40b8d3:  mov    rax,QWORD PTR [rbp+0x10]
40b8d7:  movq   xmm1,rax
40b8dc:  addsd  xmm0,xmm1
40b8e0:  movq   rax,xmm0
40b8e5:  mov    QWORD PTR [rbp-0x10],rax
40b8e9:  mov    rax,QWORD PTR [rbp-0x20]
40b8ed:  mov    QWORD PTR [rbp-0x8],rax
40b8f1:  mov    rax,QWORD PTR [rbp-0x18]
40b8f5:  add    rax,0x1
40b8f9:  mov    QWORD PTR [rbp-0x18],rax
40b8fd:  jmp    0x40b80d
40b902:  mov    rax,QWORD PTR [rbp-0x18]
40b906:  jmp    0x40b90b
40b90b:  mov    rsp,rbp
40b90e:  pop    rbp
40b90f:  ret
