// Pruebas (JS/TS) de reglas/deser-xxe.yml
declare const serialize: any;
declare const libxml: any;
declare const input: string;

// ruleid: tumi-js-unsafe-deserialization
serialize.unserialize(input);
// ok: tumi-js-unsafe-deserialization
JSON.parse(input);

// ruleid: tumi-js-xxe-libxml
libxml.parseXml(input, { noent: true });
// ok: tumi-js-xxe-libxml
libxml.parseXml(input, { noent: false });
