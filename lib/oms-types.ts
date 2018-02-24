export interface SpiderOptions {
    markersWontMove?: boolean;
    markersWontHide?: boolean;
    basicFormatEvents?: boolean;
    keepSpiderfied?: boolean;
    ignoreMapClick?: boolean;
    nearbyDistance?: number;
    circleSpiralSwitchover?: number;
    circleFootSeparation?: number;
    circleStartAngle?: number;
    spiralFootSeparation?: number;
    spiralLengthStart?: number;
    spiralLengthFactor?: number;
    legWeight?: number;
}

export interface LegColorOptions {
    usual?: {
        [type: string]: string;
    };
    highlighted?: {
        [type: string]: string;
    };
}
