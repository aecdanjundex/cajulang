4143ad:  push   rbp
4143ae:  mov    rbp,rsp
4143b1:  sub    rsp,0x0
4143b8:  mov    rax,QWORD PTR [rbp+0x10]
4143bc:  cmp    rax,0x2
4143c0:  jge    0x4143cf
4143c6:  mov    rax,QWORD PTR [rbp+0x10]
4143ca:  jmp    0x41446e
4143cf:  mov    rax,QWORD PTR [rbp+0x10]
4143d3:  sub    rax,0x1
4143d7:  push   rax
4143d8:  mov    rax,QWORD PTR [rip+0x1031]        # 0x415410
4143df:  cmp    rax,0x2710
4143e6:  jl     0x414401
4143ec:  lea    rax,[rip+0x4c35]        # 0x419028
4143f3:  push   rax
4143f4:  lea    rax,[rip+0x169d]        # 0x415a98
4143fb:  push   rax
4143fc:  call   0x40bb0c
414401:  inc    QWORD PTR [rip+0x1008]        # 0x415410
414408:  call   0x4143ad
41440d:  dec    QWORD PTR [rip+0xffc]        # 0x415410
414414:  add    rsp,0x8
414418:  push   rax
414419:  mov    rax,QWORD PTR [rbp+0x10]
41441d:  sub    rax,0x2
414421:  push   rax
414422:  mov    rax,QWORD PTR [rip+0xfe7]        # 0x415410
414429:  cmp    rax,0x2710
414430:  jl     0x41444b
414436:  lea    rax,[rip+0x4beb]        # 0x419028
41443d:  push   rax
41443e:  lea    rax,[rip+0x1653]        # 0x415a98
414445:  push   rax
414446:  call   0x40bb0c
41444b:  inc    QWORD PTR [rip+0xfbe]        # 0x415410
414452:  call   0x4143ad
414457:  dec    QWORD PTR [rip+0xfb2]        # 0x415410
41445e:  add    rsp,0x8
414462:  mov    rcx,rax
414465:  pop    rax
414466:  add    rax,rcx
414469:  jmp    0x41446e
41446e:  mov    rsp,rbp
414471:  pop    rbp
414472:  ret
