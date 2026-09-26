/** A source trail crossing a paper page: the reader can always return to evidence. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 5.5h13.2L31 13v21.5H10a3 3 0 0 1-3-3v-23a3 3 0 0 1 3-3Z" fill="#24435F" />
    <path d="M23 5.5V13h8" fill="#4A9C91" />
    <path d="M12 17h8M12 21h6" stroke="#EAF1F4" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12 27c3.3 0 3.3-4 6.7-4 3.3 0 3.3 4 6.6 4 2.4 0 3.2-1.6 5.1-2.3" stroke="#65C0AE" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="31.4" cy="24.3" r="2.2" fill="#EAB96C" />
  </svg>;
}
