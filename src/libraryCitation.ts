type CitationDocument={id:string;title:string;pages:number;family:string;source_kind:string;source_url?:string;retrieved?:string};
/** Catalogue metadata cannot turn an external reference into an executable URL. */
export function safeReferenceUrl(value: unknown): string | null {
 if (typeof value !== 'string') return null;
 try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
 catch { return null; }
}
/** File-page numbers are explicit: printed page labels can differ in the original PDF. */
export function documentCitation(doc:CitationDocument,page:number) {
 const parts=[`${doc.title}. File page ${page} of ${doc.pages}.`];
 if(doc.family)parts.push(`Instrument family: ${doc.family}.`);
 const source=safeReferenceUrl(doc.source_url);
 if(source)parts.push(`Source: ${source}`);
 else parts.push(`Local collection: ${doc.source_kind}. Publisher and revision are not recorded in this catalogue entry.`);
 if(doc.retrieved)parts.push(`Retrieved: ${doc.retrieved}.`);
 parts.push(`RHODA catalogue ID: ${doc.id}.`);
 return parts.join('\n');
}
