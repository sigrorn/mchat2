/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

declare namespace JSX {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Element extends React.ReactElement {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntrinsicElements extends React.JSX.IntrinsicElements {}
}
