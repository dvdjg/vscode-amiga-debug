import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { SymbolInformation, SymbolScope, SymbolType, Section } from '../symbols';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg !])([w ])([C ])([W ])([I ])([dD ])([FfO ])\s([^\s]+)\s([0-9a-f]+)\s(.*)\r?$/;

// [1] = Idx
// [2] = Name
// [3] = Size
// [4] = VMA
// [5] = LMA
// [6] = File off
// [7] = Algn
const SECTION_REGEX1 = /^\s+([0-9]+)\s(\S+)\s+([0-9a-f]{8})\s+([0-9a-f]{8})\s+([0-9a-f]{8})\s+([0-9a-f]{8})\s+2\*\*([0-9]+)$/;
const SECTION_REGEX2 = /^\s+\w+(, \w+)*$/;

const TYPE_MAP: { [id: string]: SymbolType } = {
	'F': SymbolType.Function,
	'f': SymbolType.File,
	'O': SymbolType.Object,
	' ': SymbolType.Normal
};

const SCOPE_MAP: { [id: string]: SymbolScope } = {
	'l': SymbolScope.Local,
	'g': SymbolScope.Global,
	' ': SymbolScope.Neither,
	'!': SymbolScope.Both
};

export class SymbolTable {
	public symbols: SymbolInformation[];
	public sections: Section[];

	constructor(private objdumpPath: string, private executable: string) {
		this.getSections();
		this.getSymbols();
	}

	private getSections() {
		this.sections = [];
		const objdump = childProcess.spawnSync(this.objdumpPath, ['--section-headers', this.executable]);
		if(objdump.status !== 0)
			throw objdump.error;
		const lines = objdump.stdout.toString().replace(/\r/g, '').split('\n');
		for(let i = 0; i < lines.length; i++) {
			const match1 = lines[i].match(SECTION_REGEX1);
			if(match1) {
				const flags = lines[++i].trim().split(', ');
				this.sections.push({
					name: match1[2],
					address: 0,
					size: parseInt(match1[3], 16),
					vma: parseInt(match1[4], 16),
					lma: parseInt(match1[5], 16),
					fileOffset: parseInt(match1[6], 16),
					align: 2**parseInt(match1[7]),
					flags
				});
			}
		}
		//console.log(this.sections);
	}

	private getSymbols() {
		if(this.sections.length === 0)
			throw new Error("call getSections() before getSymbols()!");

		this.symbols = [];
		const objdump = childProcess.spawnSync(this.objdumpPath, ['--syms', '--demangle', this.executable], { maxBuffer: 10*1024*1024 });
		if(objdump.status !== 0)
			throw objdump.error;
		const lines = objdump.stdout.toString().replace(/\r/g, '').split('\n');
		let currentFile: string | null = null;

		for (const line of lines) {
			const match = line.match(SYMBOL_REGEX);
			if (match) {
				if (match[7] === 'd' && match[8] === 'f') {
					currentFile = match[11].trim();
				}
				const type = TYPE_MAP[match[8]];
				let scope = SCOPE_MAP[match[2]];
				let name = match[11].trim();
				let hidden = false;

				if (name.startsWith('.hidden')) {
					name = name.substring(7).trim();
					hidden = true;
				}

				// fix for LTO
				if(scope === SymbolScope.Local && (!currentFile || currentFile === "<artificial>"))
					scope = SymbolScope.Global;

				const sectionName = match[9].trim();
				const section = this.sections.find((s) => s.name === sectionName);
				if(sectionName !== "*ABS*" && section === undefined)
					throw new Error(`Section ${sectionName} not found. Symbol: ${name}`);

				this.symbols.push({
					address: parseInt(match[1], 16) - (section?.lma ?? 0),
					base: 0,
					type,
					scope,
					section: sectionName,
					size: parseInt(match[10], 16),
					name,
					lines: null,
					file: scope === SymbolScope.Local ? currentFile : null,
					hidden
				});
			}
		}
	}

	public relocate(relocatedSections: Section[]) {
		console.log(`SymbolTable.relocate: Received ${relocatedSections.length} relocated sections`);
		relocatedSections.forEach((relocatedSection) => {
			console.log(`  Input: ${relocatedSection.name} -> 0x${relocatedSection.address.toString(16)}`);
			const section = this.sections.find((s) => s.name === relocatedSection.name);
			if(section) {
				console.log(`  Found matching section ${section.name}, updating address from 0x${section.address.toString(16)} to 0x${relocatedSection.address.toString(16)}`);
				section.address = relocatedSection.address;
			} else {
				console.log(`  WARNING: No matching section found for ${relocatedSection.name}`);
			}
		});

		console.log(`SymbolTable.relocate: Updating ${this.symbols.length} symbol bases`);
		let updatedCount = 0;
		this.symbols.forEach((symbol) => {
			const section = this.sections.find((s) => s.name === symbol.section);
			if(section) {
				symbol.base = section.address;
				updatedCount++;
			}
		});
		console.log(`SymbolTable.relocate: Updated ${updatedCount} symbols`);
		
		// Log first few functions for verification
		const funcs = this.symbols.filter(s => s.type === 0).slice(0, 5); // SymbolType.Function = 0
		funcs.forEach(f => {
			console.log(`  Sample func: ${f.name} addr=0x${f.address.toString(16)} base=0x${f.base.toString(16)} -> relocated=0x${(f.address + f.base).toString(16)}`);
		});
	}
	
	// Alternative relocation method: apply a fixed offset to all ALLOC sections
	public relocateWithOffset(loadOffset: number) {
		console.log(`SymbolTable.relocateWithOffset: Applying offset 0x${loadOffset.toString(16)}`);
		let sectionCount = 0;
		for(const section of this.sections) {
			if(section.flags && section.flags.find((v) => v === "ALLOC") && section.size > 0) {
				const oldAddr = section.address;
				section.address = section.vma + loadOffset;
				console.log(`  Section ${section.name}: 0x${oldAddr.toString(16)} -> 0x${section.address.toString(16)}`);
				sectionCount++;
			}
		}
		console.log(`SymbolTable.relocateWithOffset: Relocated ${sectionCount} sections`);
		
		// Update symbol bases
		let symbolCount = 0;
		this.symbols.forEach((symbol) => {
			const section = this.sections.find((s) => s.name === symbol.section);
			if(section) {
				symbol.base = section.address;
				symbolCount++;
			}
		});
		console.log(`SymbolTable.relocateWithOffset: Updated ${symbolCount} symbol bases`);
		
		// Log first few functions for verification
		const funcs = this.symbols.filter(s => s.type === SymbolType.Function).slice(0, 5);
		funcs.forEach(f => {
			console.log(`  Sample func: ${f.name} addr=0x${f.address.toString(16)} base=0x${f.base.toString(16)} -> relocated=0x${(f.address + f.base).toString(16)}`);
		});
	}

	public getRelocatedSections(relocatedBases: Uint32Array): Section[] {
		const sections: Section[] = [];
		let count = 0;
		for(const section of this.sections) {
			if(section.flags.find((v) => v === "ALLOC") && section.size > 0) // this line has to match binutils-gdb/gdb/remote.c
				sections.push({ ...section, address: relocatedBases[count++] });
			else
				sections.push({ ...section, address: section.vma }); // just fallback
		}
		if(count !== relocatedBases.length)
			throw(new Error(`SymbolTable.getLocatedSections: number of sections mismatch (${relocatedBases.length} != ${count})`));
		return sections;
	}

	public getFunctionAtAddress(address: number, relocated: boolean): SymbolInformation | null {
		console.log(`SymbolTable.getFunctionAtAddress: Looking for 0x${address.toString(16)}, relocated=${relocated}`);
		const matches = this.symbols.filter((s) => {
			let symAddress = s.address;
			if(relocated)
				symAddress += s.base;
			return s.type === SymbolType.Function && symAddress <= address && (symAddress + s.size) > address;
		});
		if (!matches || matches.length === 0) {
			// Log some nearby functions for debugging
			const functions = this.symbols.filter(s => s.type === SymbolType.Function);
			const nearby = functions.slice(0, 3);
			console.log(`  No match found. Sample functions:`);
			nearby.forEach(f => {
				const base = relocated ? f.base : 0;
				console.log(`    ${f.name}: addr=0x${f.address.toString(16)} base=0x${base.toString(16)} -> 0x${(f.address + base).toString(16)} size=${f.size}`);
			});
			return null;
		}

		console.log(`  Found: ${matches[0].name}`);
		return matches[0];
	}

	public getFunctionSymbols(): SymbolInformation[] {
		return this.symbols.filter((s) => s.type === SymbolType.Function);
	}

	public getGlobalVariables(): SymbolInformation[] {
		const matches = this.symbols.filter((s) => s.type === SymbolType.Object && s.scope === SymbolScope.Global);
		return matches;
	}

	public getSymbolVariables(): SymbolInformation[] {
		const matches = this.symbols.filter((s) =>
			s.type === SymbolType.Normal &&
			s.size === 0 &&
			s.name &&
			s.base > 0
		);
		return matches;
	}

	public getConstVariables(): SymbolInformation[] {
		const matches = this.symbols.filter((s) =>
			s.type === SymbolType.Normal &&
			s.size === 0 &&
			s.scope === SymbolScope.Local &&
			s.name &&
			!s.name.startsWith(".") &&
			s.base === 0
		);
		return matches;
	}

	public getStaticVariables(file: string): SymbolInformation[] {
		return this.symbols.filter((s) => s.type === SymbolType.Object && s.scope === SymbolScope.Local && s.file === file);
	}

	public getFunctionByName(name: string, file?: string): SymbolInformation | null {
		// Try to find static function first
		let matches = this.symbols.filter((s) => s.type === SymbolType.Function && s.scope === SymbolScope.Local && s.name === name && s.file === file);
		if (matches.length !== 0) { return matches[0]; }

		// Fall back to global scope
		matches = this.symbols.filter((s) => s.type === SymbolType.Function && s.scope !== SymbolScope.Local && s.name === name);
		return matches.length !== 0 ? matches[0] : null;
	}
}
