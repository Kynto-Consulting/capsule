// Pruebas de reglas/react.yml
import DOMPurify from "dompurify";

export function A({ html }: { html: string }) {
  // ruleid: tumi-react-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function B({ html }: { html: string }) {
  // ok: tumi-react-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}

export function C() {
  // ok: tumi-react-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: "<b>fijo</b>" }} />;
}
