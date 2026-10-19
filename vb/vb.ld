/* Virtual Boy ROM layout: code and constants in a 64KB ROM mapped at
 * 0x07000000 (its last 0x220 bytes are the header and vectors), variables
 * in the 64KB of work RAM at 0x05000000. */
OUTPUT_FORMAT("elf32-v810", "elf32-v810", "elf32-v810")
OUTPUT_ARCH(v810)
ENTRY(_start)
MEMORY
{
  rom (rx)   : ORIGIN = 0x07000000, LENGTH = 64K
  wram (rwx) : ORIGIN = 0x05000000, LENGTH = 64K
}
__stack = 0x0500FFF0;
SECTIONS
{
  .text : { *(.text.crt0) *(.text) *(.text.*) . = ALIGN(4); } > rom
  .rodata : { *(.rodata) *(.rodata.*) . = ALIGN(4); } > rom
  .data : { __data_start = .; *(.data) *(.data.*) *(.sdata) *(.sdata.*) . = ALIGN(4); __data_end = .; } > wram AT > rom
  __data_lma = LOADADDR(.data);
  .bss (NOLOAD) : { __bss_start = .; *(.bss) *(.bss.*) *(.sbss) *(.sbss.*) *(COMMON) . = ALIGN(4); __bss_end = .; } > wram
  .vectors ORIGIN(rom) + LENGTH(rom) - 0x220 : { KEEP(*(.vectors)) } > rom
  /DISCARD/ : { *(.comment) *(.note*) *(.gnu.attributes) }
}
