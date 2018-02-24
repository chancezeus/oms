/** @preserve OverlappingMarkerSpiderfier
 * https://github.com/jawj/OverlappingMarkerSpiderfier
 * Copyright (c) 2011 - 2017 George MacKerron
 * Released under the MIT licence: http://opensource.org/licenses/mit-license
 */
import {LegColorOptions, SpiderOptions} from './oms-types';

// NB. string literal properties -- object['key'] -- are for Closure Compiler ADVANCED_OPTIMIZATION

declare const google: any;

export class MarkerStatus {
    // universal status
    static readonly SPIDERFIED: string = 'SPIDERFIED';
    // statuses reported under standard regine
    static readonly SPIDERFIABLE: string = 'SPIDERFIABLE';
    static readonly UNSPIDERFIABLE: string = 'UNSPIDERFIABLE';
    // status reported under simple status update regime only
    static readonly UNSPIDERFIED: string = 'UNSPIDERFIED';
}

export class OverlappingMarkerSpiderfier implements SpiderOptions {
    private readonly spiderfiedZIndex: number = google.maps.Marker.MAX_ZINDEX + 20000;
    private readonly highlightedLegZIndex: number = google.maps.Marker.MAX_ZINDEX + 10000;
    private readonly usualLegZIndex: number = google.maps.Marker.MAX_ZINDEX + 1;

    static readonly markerStatus: typeof MarkerStatus = MarkerStatus;

    private projectionHelper: any;

    private listeners: {
        [eventName: string]: Function[]
    };
    private markers: google.maps.Marker[] = [];
    private markerListenerRefs: Array<google.maps.MapsEventListener[]> = [];

    private formatTimeoutId: number;
    private formatIdleListener: google.maps.MapsEventListener;

    private spiderfied: boolean = false;
    private spiderfying: boolean = false;
    private unspiderfying: boolean = false;

    legColors: LegColorOptions = {
        highlighted: {
            [google.maps.MapTypeId.HYBRID]: '#f00',
            [google.maps.MapTypeId.ROADMAP]: '#f00',
            [google.maps.MapTypeId.SATELLITE]: '#f00',
            [google.maps.MapTypeId.TERRAIN]: '#f00',
        },
        usual: {
            [google.maps.MapTypeId.HYBRID]: '#fff',
            [google.maps.MapTypeId.ROADMAP]: '#444',
            [google.maps.MapTypeId.SATELLITE]: '#fff',
            [google.maps.MapTypeId.TERRAIN]: '#444',
        }
    };
    markersWontHide: boolean = false;
    markersWontMove: boolean = false;
    basicFormatEvents: boolean = false;
    keepSpiderfied: boolean = false;
    ignoreMapClick: boolean = false;
    nearbyDistance: number = 20;
    circleSpiralSwitchover: number = 9;
    circleFootSeparation: number = 23;
    circleStartAngle: number = Math.PI / 6;
    spiralFootSeparation: number = 26;
    spiralLengthStart: number = 11;
    spiralLengthFactor: number = 4;
    legWeight: number = 1.5;

    readonly VERSION: string = '1.0.3';

    private static optionAttributes: string[] = [
        'markersWontHide',
        'markersWontMove',
        'basicFormatEvents',
        'keepSpiderfied',
        'ignoreMapClick',
        'nearbyDistance',
        'circleSpiralSwitchover',
        'circleFootSeparation',
        'circleStartAngle',
        'spiralFootSeparation',
        'spiralLengthStart',
        'spiralLengthFactor',
        'legWeight',
    ];

    private doFormatMarkers() {
        const result = [];
        let marker: any;
        let status: string;

        // only formatMarkers is allowed to call this directly
        if (this.basicFormatEvents) {
            for (let i = 0; i < this.markers.length; i++) {
                marker = this.markers[i] as any;
                status = marker['_omsData'] ? OverlappingMarkerSpiderfier.markerStatus.SPIDERFIED :
                    OverlappingMarkerSpiderfier.markerStatus.UNSPIDERFIED;

                result.push(this.trigger('format', marker, status));
            }

            return result;
        }

        const proximities = this.markerProximityData(); // {pt, willSpiderfy}[]
        for (let i = 0; i < this.markers.length; i++) {
            marker = this.markers[i] as any;
            status = marker['_omsData'] ?
                OverlappingMarkerSpiderfier.markerStatus.SPIDERFIED :
                proximities[i].willSpiderfy ?
                    OverlappingMarkerSpiderfier.markerStatus.SPIDERFIABLE :
                    OverlappingMarkerSpiderfier.markerStatus.UNSPIDERFIABLE;

            result.push(this.trigger('format', marker, status));
        }

        return result;
    }

    private formatMarkers() {
        if (this.basicFormatEvents) {
            return;
        }

        if (this.formatTimeoutId) {
            return;
        } // only format markers once per run loop (in case e.g. being called repeatedly from addMarker)

        return this.formatTimeoutId = window.setTimeout(() => {
            this.formatTimeoutId = null;

            if (this.projectionHelper.getProjection()) {
                return this.doFormatMarkers();
            }

            if (this.formatIdleListener) {
                return;
            } // if the map is not yet ready, and we're not already waiting, wait until it is ready

            return this.formatIdleListener = google.maps.event.addListenerOnce(this.map, 'idle', () => this.doFormatMarkers());
        }, 50);
    }

    private generatePtsCircle(count: number, centerPt: { x: number, y: number }) {
        let circumference = this.circleFootSeparation * (2 + count);
        let legLength = circumference / (2 * Math.PI); // = radius from circumference
        let angleStep = 2 * Math.PI / count;

        let result = [];
        for (let i = 0, end = count, asc = 0 <= end; asc ? i < end : i > end; asc ? i++ : i--) {
            let angle = this.circleStartAngle + i * angleStep;

            result.push(new google.maps.Point(centerPt.x + legLength * Math.cos(angle), centerPt.y + legLength * Math.sin(angle)));
        }
        return result;
    }

    private generatePtsSpiral(count: number, centerPt: { x: number, y: number }) {
        let legLength = this.spiralLengthStart;

        let angle = 0;
        let result = [];

        for (let i = 0, end = count, asc = 0 <= end; asc ? i < end : i > end; asc ? i++ : i--) {
            angle += this.spiralFootSeparation / legLength + i * 0.0005;

            let pt = new google.maps.Point(centerPt.x + legLength * Math.cos(angle), centerPt.y + legLength * Math.sin(angle));
            legLength += Math.PI * 2 * this.spiralLengthFactor / angle;

            result.push(pt);
        }

        return result;
    }

    private initMarkerArrays() {
        this.markers = [];
        this.markerListenerRefs = [];
    }

    private llToPt(ll: any) {
        return this.projectionHelper.getProjection().fromLatLngToDivPixel(ll);
    }

    private makeHighlightListenerFuncs(marker: any) {
        const mapTypeId: string = this.map.getMapTypeId() as string;

        return {
            highlight: () => marker['_omsData'].leg.setOptions({
                strokeColor: this.legColors.highlighted[mapTypeId],
                zIndex: this.highlightedLegZIndex
            }),
            unhighlight: () => marker['_omsData'].leg.setOptions({
                strokeColor: this.legColors.usual[mapTypeId],
                zIndex: this.usualLegZIndex
            })
        };
    }

    private markerChangeListener(marker: any, positionChanged: boolean) {
        if (this.spiderfying || this.unspiderfying) {
            return;
        }

        if (marker['_omsData'] && (positionChanged || !marker.getVisible())) {
            this.unspiderfy(positionChanged ? marker : null);
        }

        return this.formatMarkers();
    }

    private markerProximityData() {
        if (this.projectionHelper.getProjection() == null) {
            throw 'Must wait for \'idle\' event on map before calling markersNearAnyOtherMarker';
        }

        let nDist = this.nearbyDistance;
        let pxSq = nDist * nDist;

        let mData = this.markers.map((marker: any) => ({
            pt: this.llToPt(marker['_omsData'] && marker['_omsData'].usualPosition || marker.position),
            willSpiderfy: false
        }));

        for (let i1 = 0; i1 < this.markers.length; i1++) {
            let m1 = this.markers[i1] as any;
            if (m1.getMap() == null || !m1.getVisible()) {
                continue;
            } // marker not visible: ignore

            let m1Data = mData[i1];
            if (m1Data.willSpiderfy) {
                continue;
            } // true in the case that we've assessed an earlier marker that was near this one

            for (let i2 = 0; i2 < this.markers.length; i2++) {
                let m2 = this.markers[i2] as any;

                if (i2 === i1) {
                    continue;
                } // markers cannot be near themselves: ignore

                if (m2.getMap() == null || !m2.getVisible()) {
                    continue;
                } // marker not visible: ignore

                let m2Data = mData[i2];
                if (i2 < i1 && !m2Data.willSpiderfy) {
                    continue;
                } // if i2 < i1, m2 has already been checked for proximity to any other marker;

                // so if willSpiderfy is false, it cannot be near any other marker, including this one (m1)
                if (OverlappingMarkerSpiderfier.ptDistanceSq(m1Data.pt, m2Data.pt) < pxSq) {
                    m1Data.willSpiderfy = m2Data.willSpiderfy = true;
                    break;
                }
            }
        }

        return mData;
    }

    private static minExtract(set: any[], callback: (item: any) => number) {
        // destructive! returns minimum, and also removes it from the set
        let bestIndex = null;
        let bestValue = null;

        for (let index = 0; index < set.length; index++) {
            let item = set[index];

            let value = callback(item);
            if (bestIndex === null || value < bestValue) {
                bestValue = value;
                bestIndex = index;
            }
        }

        return set.splice(bestIndex, 1)[0];
    }

    private static ptAverage(points: Array<{ x: number, y: number }>) {
        const {x, y} = points.reduce((result, current) => {
            result.x += current.x;
            result.y += current.y;

            return result;
        }, {x: 0, y: 0});

        return new google.maps.Point(x / points.length, y / points.length);
    }

    private static ptDistanceSq(pt1: { x: number, y: number }, pt2: { x: number, y: number }) {
        let dx = pt1.x - pt2.x;
        let dy = pt1.y - pt2.y;
        return dx * dx + dy * dy;
    }

    private ptToLl(pt: any) {
        return this.projectionHelper.getProjection().fromDivPixelToLatLng(pt);
    }

    private spiderfy(markerData: any[], nonNearbyMarkers: any[]) {
        const mapTypeId = this.map.getMapTypeId();
        const numFeet = markerData.length;

        this.spiderfying = true;

        const bodyPt = OverlappingMarkerSpiderfier.ptAverage(markerData.map(data => data.markerPt));

        const footPts = numFeet >= this.circleSpiralSwitchover ?
            this.generatePtsSpiral(numFeet, bodyPt).reverse() : // match from outside in => less criss-crossing
            this.generatePtsCircle(numFeet, bodyPt);

        const spiderfiedMarkers = footPts.map(footPt => {
            const footLl = this.ptToLl(footPt);
            const nearestMarkerDatum = OverlappingMarkerSpiderfier.minExtract(markerData, (data: any) => OverlappingMarkerSpiderfier.ptDistanceSq(data.markerPt, footPt));
            const {marker} = nearestMarkerDatum;

            const leg = new google.maps.Polyline({
                map: this.map,
                path: [marker.position, footLl],
                strokeColor: this.legColors.usual[this.map.getMapTypeId()],
                strokeWeight: this.legWeight,
                zIndex: this.usualLegZIndex
            });

            marker['_omsData'] = {
                usualPosition: marker.getPosition(),
                usualZIndex: marker.getZIndex(),
                leg
            };

            if (this.legColors.highlighted[mapTypeId] !== this.legColors.usual[mapTypeId]) {
                const highlightListenerFuncs = this.makeHighlightListenerFuncs(marker);

                marker['_omsData'].hightlightListeners = {
                    highlight: google.maps.event.addListener(marker, 'mouseover', highlightListenerFuncs.highlight),
                    unhighlight: google.maps.event.addListener(marker, 'mouseout', highlightListenerFuncs.unhighlight)
                };
            }

            this.trigger('format', marker, OverlappingMarkerSpiderfier.markerStatus.SPIDERFIED);

            marker.setPosition(footLl);
            marker.setZIndex(Math.round(this.spiderfiedZIndex + footPt.y)); // lower markers cover higher

            return marker;
        });

        this.spiderfying = false;
        this.spiderfied = true;

        return this.trigger('spiderfy', spiderfiedMarkers, nonNearbyMarkers);
    }

    private spiderListener(marker: any, event: any) {
        let markerSpiderfied = !!marker['_omsData'];

        if (!markerSpiderfied || !this.keepSpiderfied) {
            this.unspiderfy();
        }

        if (markerSpiderfied || this.map.getStreetView().getVisible() || this.map.getMapTypeId() === 'GoogleEarthAPI') {
            // don't spiderfy in Street View or GE Plugin!
            return this.trigger('click', marker, event);
        }

        let nearbyMarkerData = [];
        let nonNearbyMarkers = [];
        let nDist = this.nearbyDistance;
        let pxSq = nDist * nDist;
        let markerPt = this.llToPt(marker.position);

        for (let i = 0; i < this.markers.length; i++) {
            const m = this.markers[i] as any;
            if (m.map == null || !m.getVisible()) {
                continue;
            } // at 2011-08-12, property m.visible is undefined in API v3.5

            const mPt = this.llToPt(m.position);
            if (OverlappingMarkerSpiderfier.ptDistanceSq(mPt, markerPt) < pxSq) {
                nearbyMarkerData.push({marker: m, markerPt: mPt});
            } else {
                nonNearbyMarkers.push(m);
            }
        }

        if (nearbyMarkerData.length === 1) {
            // 1 => the one clicked => none nearby
            return this.trigger('click', marker, event);
        }

        return this.spiderfy(nearbyMarkerData, nonNearbyMarkers);
    }

    private trigger(eventName: string, ...args: any[]) {
        if (this.listeners[eventName]) {
            return this.listeners[eventName].map(listener => listener(...args));
        }

        return [];
    }

    addMarker(marker: google.maps.Marker, spiderClickHandler: Function): OverlappingMarkerSpiderfier {
        marker.setMap(this.map);
        return this.trackMarker(marker, spiderClickHandler);
    }

    trackMarker(marker: any, spiderClickHandler: Function): OverlappingMarkerSpiderfier {
        if (marker['_oms']) {
            return this;
        }

        marker['_oms'] = true;

        // marker.setOptions optimized: no  # 'optimized' rendering is sometimes buggy, but seems mainly OK on current GMaps
        let listenerRefs: google.maps.MapsEventListener[] = [
            google.maps.event.addListener(marker, 'click', (event: any) => this.spiderListener(marker, event))
        ];

        if (!this.markersWontHide) {
            listenerRefs.push(
                google.maps.event.addListener(marker, 'visible_changed', () => this.markerChangeListener(marker, false))
            );
        }

        if (!this.markersWontMove) {
            listenerRefs.push(
                google.maps.event.addListener(marker, 'position_changed', () => this.markerChangeListener(marker, true))
            );
        }

        if (spiderClickHandler) {
            listenerRefs.push(
                google.maps.event.addListener(marker, 'spider_click', spiderClickHandler)
            );
        }

        this.markerListenerRefs.push(listenerRefs);
        this.markers.push(marker);

        if (this.basicFormatEvents) {
            // if using basic events, just format this marker as unspiderfied
            this.trigger('format', marker, OverlappingMarkerSpiderfier.markerStatus.UNSPIDERFIED);
        } else {
            // otherwise, format as unspiderfiable now, and recalculate all marker formatting at end of run loop
            this.trigger('format', marker, OverlappingMarkerSpiderfier.markerStatus.UNSPIDERFIABLE);
            this.formatMarkers();
        }

        return this; // return self, for chaining
    }

    removeMarker(marker: any) {
        this.forgetMarker(marker);
        marker.setMap(null);

        return this;
    }

    forgetMarker(marker: any) {
        if (marker['_omsData']) {
            this.unspiderfy();
        }

        const index = this.markers.indexOf(marker);
        if (index !== -1) {
            const listenerRefs = this.markerListenerRefs.splice(index, 1)[0];
            listenerRefs.forEach(listener => listener.remove());
            delete marker['_oms'];

            this.markers.splice(index, 1);

            this.formatMarkers();
        }

        return this;
    }

    removeAllMarkers() {
        const markers = this.getMarkers();

        this.forgetAllMarkers();

        markers.forEach(marker => marker.setMap(null));

        return this;
    }

    forgetAllMarkers() {
        this.unspiderfy();

        this.markerListenerRefs.forEach(listeners => {
            listeners.forEach(listener => listener.remove());
        });

        this.markers.forEach((marker: any) => {
            delete marker['_oms'];
        });

        this.initMarkerArrays();
        return this;
    }

    getMarkers() {
        return this.markers.slice();
    }

    addListener(eventName: 'click' | 'spiderfy' | 'unspiderfy' | 'format', listener: Function) {
        this.listeners[eventName] = this.listeners[eventName] || [];

        this.listeners[eventName].push(listener);

        return this;
    }

    removeListener(eventName: 'click' | 'spiderfy' | 'unspiderfy' | 'format', listener: Function) {
        if (this.listeners[eventName]) {
            const index = this.listeners[eventName].indexOf(listener);

            if (index !== -1) {
                this.listeners[eventName].splice(index, 1);
            }
        }

        return this;
    }

    clearListeners(eventName: 'click' | 'spiderfy' | 'unspiderfy' | 'format') {
        this.listeners[eventName] = [];

        return this;
    }

    markersNearMarker(marker: any, firstOnly: boolean = false) {
        if (this.projectionHelper.getProjection() == null) {
            throw 'Must wait for \'idle\' event on map before calling markersNearMarker';
        }

        const nDist = this.nearbyDistance;
        const pxSq = nDist * nDist;

        const markerPt = this.llToPt(marker.position);
        const markers: google.maps.Marker[] = [];

        for (let i = 0; i < this.markers.length; i++) {
            const current = this.markers[i] as any;

            if (current === marker || current.map == null || !current.getVisible()) {
                continue;
            }

            let mPt = this.llToPt(current['_omsData'] && current['_omsData'].usualPosition || current.position);

            if (OverlappingMarkerSpiderfier.ptDistanceSq(mPt, markerPt) < pxSq) {
                markers.push(current);

                if (firstOnly) {
                    break;
                }
            }
        }

        return markers;
    }

    markersNearAnyOtherMarker() {
        // *very* much quicker than calling markersNearMarker in a loop
        const mData = this.markerProximityData();

        const result = [];
        for (let i = 0; i < this.markers.length; i++) {
            let m = this.markers[i];

            if (mData[i].willSpiderfy) {
                result.push(m);
            }
        }

        return result;
    }

    unspiderfy(markerNotToMove: any = null) {
        if (!this.spiderfied) {
            return this;
        }

        this.unspiderfying = true;
        const unspiderfiedMarkers = [];
        const nonNearbyMarkers = [];

        for (let i = 0; i < this.markers.length; i++) {
            const marker = this.markers[i] as any;

            if (marker['_omsData']) {
                marker['_omsData'].leg.setMap(null);

                if (marker !== markerNotToMove) {
                    marker.setPosition(marker['_omsData'].usualPosition);
                }
                marker.setZIndex(marker['_omsData'].usualZIndex);

                let listeners = marker['_omsData'].hightlightListeners;
                if (listeners) {
                    google.maps.event.removeListener(listeners.highlight);
                    google.maps.event.removeListener(listeners.unhighlight);
                }
                delete marker['_omsData'];

                if (marker !== markerNotToMove) {
                    // if marker is markerNotToMove, formatMarkers is about to be called anyway
                    let status = this.basicFormatEvents ?
                        OverlappingMarkerSpiderfier.markerStatus.UNSPIDERFIED :
                        OverlappingMarkerSpiderfier.markerStatus.SPIDERFIABLE; // unspiderfying? must be spiderfiable

                    this.trigger('format', marker, status);
                }

                unspiderfiedMarkers.push(marker);
            } else {
                nonNearbyMarkers.push(marker);
            }
        }

        this.unspiderfying = false;
        this.spiderfied = false;

        this.trigger('unspiderfy', unspiderfiedMarkers, nonNearbyMarkers);

        return this; // return self, for chaining
    }

    constructor(private map: google.maps.Map, options: SpiderOptions = {}) {
        const keys = Object.keys(OverlappingMarkerSpiderfier.optionAttributes)
            .filter(key => typeof (<any>options)[key] !== 'undefined');

        keys.forEach(key => {
            (<any>this)[key] = (<any>options)[key];
        });

        this.projectionHelper = new (class extends (google.maps.OverlayView as { new(): any; draw(): void; setMap(map: google.maps.Map | google.maps.StreetViewPanorama | null): void }) {
            constructor(map: any) {
                super();
                this.setMap(map);
            }

            draw() {
            }
        })(this.map);

        this.initMarkerArrays();
        this.listeners = {};
        this.formatIdleListener = this.formatTimeoutId = null;

        this.addListener('click', (marker: google.maps.Marker, event: google.maps.MouseEvent) => google.maps.event.trigger(marker, 'spider_click', event)); // new-style events, easier to integrate
        this.addListener('format', (marker: google.maps.Marker, status: typeof MarkerStatus) => google.maps.event.trigger(marker, 'spider_format', status));

        if (!this.ignoreMapClick) {
            google.maps.event.addListener(this.map, 'click', () => this.unspiderfy());
        }

        google.maps.event.addListener(this.map, 'maptypeid_changed', () => this.unspiderfy());
        google.maps.event.addListener(this.map, 'zoom_changed', () => {
            this.unspiderfy();

            if (!this.basicFormatEvents) {
                return this.formatMarkers();
            }
        });
    }
}
