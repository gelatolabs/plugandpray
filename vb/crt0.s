/* Start-up code for the Virtual Boy: set up the stack, copy initialised data
 * to work RAM, clear .bss and call main. Also the ROM header, interrupt
 * vectors (all ignored) and the reset vector at the very end of the ROM. */
	.section .text.crt0, "ax"
	.global _start
_start:
	/* work RAM needs a moment after power-on before it can be used */
	movea	0x2000, r0, r6
1:	add	-1, r6
	bnz	1b
	movhi	hi(__stack), r0, sp
	movea	lo(__stack), sp, sp
	movhi	hi(__data_lma), r0, r6
	movea	lo(__data_lma), r6, r6
	movhi	hi(__data_start), r0, r7
	movea	lo(__data_start), r7, r7
	movhi	hi(__data_end), r0, r8
	movea	lo(__data_end), r8, r8
2:	cmp	r8, r7
	bnl	3f
	ld.w	0[r6], r9
	st.w	r9, 0[r7]
	add	4, r6
	add	4, r7
	br	2b
3:	movhi	hi(__bss_start), r0, r7
	movea	lo(__bss_start), r7, r7
	movhi	hi(__bss_end), r0, r8
	movea	lo(__bss_end), r8, r8
4:	cmp	r8, r7
	bnl	5f
	st.w	r0, 0[r7]
	add	4, r7
	br	4b
5:	jal	_main
6:	br	6b

	.section .vectors, "ax"
	/* 0xFFFFFDE0: header */
	.ascii	"VIRTUALATO          "
	.byte	0, 0, 0, 0, 0
	.ascii	"GL"
	.ascii	"VRTL"
	.byte	0
	/* 0xFFFFFE00 - 0xFFFFFFEF: interrupt and exception vectors */
	.rept	31
	reti
	.fill	14, 1, 0
	.endr
	/* 0xFFFFFFF0: reset */
	movhi	hi(_start), r0, r1
	movea	lo(_start), r1, r1
	jmp	[r1]
	.fill	6, 1, 0
