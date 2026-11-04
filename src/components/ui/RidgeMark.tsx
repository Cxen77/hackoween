import React from 'react';

export interface RidgeMarkProps {
  className?: string;
  width?: number;
  height?: number;
  paperColor?: string;
}

/**
 * Two peaks with mist drawn through them. The bands slide apart on hover.
 * The official FloodCast mark from the Ridgeline Dither footer.
 */
export function RidgeMark({
  className = 'floodcast-ridge-mark',
  width = 30,
  height = 21,
  paperColor = '#ffffff',
}: RidgeMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 30 21"
      width={width}
      height={height}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
    >
      <path fill="currentColor" d="M0 21 L10.5 3 L16 12.2 L20.5 6.5 L30 21 Z" />
      <rect className="rdf-mist-a" x="-2" y="12.6" width="19" height="1.7" fill={paperColor} />
      <rect className="rdf-mist-b" x="13" y="16.4" width="19" height="1.7" fill={paperColor} />
    </svg>
  );
}

export default RidgeMark;
