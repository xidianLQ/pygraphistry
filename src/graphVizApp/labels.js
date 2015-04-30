'use strict';

var debug   = require('debug')('graphistry:StreamGL:graphVizApp:labels');
var $       = window.$;
var Rx      = require('rx');
              require('../rx-jquery-stub');
var _       = require('underscore');

var util            = require('./util.js');
var interaction     = require('./interaction.js');
var picking         = require('../picking.js');

// HACK because we can't know what the mouse position is without watching events
var mousePosition = {x: 0, y: 0};

document.addEventListener('mousemove', function(e) {
    mousePosition.x = e.clientX || e.pageX;
    mousePosition.y = e.clientY || e.pageY;
}, false);

// AppState * $DOM * {dim:int, idx:int} * {dim:int, idx:int} -> ()
// Immediately reposition each label based on camera and curPoints buffer
function renderPointLabels(appState, $labelCont, labels, clicked) {
    debug('rendering labels');

    var curPoints = appState.renderState.get('hostBuffers').curPoints;
    if (!curPoints) {
        console.warn('renderLabels called before curPoints available');
        return;
    }
    curPoints.take(1)
        .do(function (curPoints) {
            renderLabelsImmediate(appState, $labelCont, curPoints, labels, clicked);
        })
        .subscribe(_.identity, util.makeErrorHandler('renderLabels'));
}

// RenderState * Obserbable * Observable
function setupCursor(renderState, renderingScheduler, isAnimating, latestHighlightedObject) {
    var rxPoints = renderState.get('hostBuffers').curPoints;
    var rxSizes = renderState.get('hostBuffers').pointSizes;

    var $cont = $('#highlighted-point-cont');
    var $point = $('.highlighted-point');
    var $center = $('.highlighted-point-center');
    var animating = isAnimating.filter(function (v) { return v === true; });
    var notAnimating = isAnimating.filter(function (v) { return v === false; });

    animating.subscribe(function () {
        $cont.css({display: 'none'});
    }, util.makeErrorHandler('renderCursor isAnimating'));

    notAnimating.flatMapLatest(function () {
        return rxPoints.combineLatest(
            rxSizes,
            latestHighlightedObject,
            function (p, s, i) {
                return {
                    points: new Float32Array(p.buffer),
                    sizes: new Uint8Array(s.buffer),
                    indices: i
                };
            }
        ).takeUntil(animating);
    }).do(function (data) {
        renderCursor(renderState, renderingScheduler, $cont, $point, $center, data.points, data.sizes, data.indices);
    }).subscribe(_.identity, util.makeErrorHandler('setupCursor'));
}

// RenderState * Dom * Dom * Dom * Float32Array * Uint8Array * [Object]
function renderCursor(renderState, renderingScheduler, $cont, $point, $center, points, sizes, indices) {
    var idx = indices[indices.length - 1].idx;
    var dim = indices[indices.length - 1].dim;

    // Highlight Edge (TODO: Highlight points through renderer)
    if (dim === 2) {
        $cont.css({display: 'none'});
        renderingScheduler.renderScene('mouseOver', {
            trigger: 'mouseOverEdgeHighlight',
            data: {
                edgeIndices: [idx]
            }
        });
        return;
    }

    if (idx === undefined || idx < 0) {
        $cont.css({display: 'none'});
        return;
    }
    $cont.css({display: 'block'});

    var camera = renderState.get('camera');
    var cnv = renderState.get('canvas');
    var pixelRatio = camera.pixelRatio;
    var mtx = camera.getMatrix();

    var pos = camera.canvasCoords(points[2 * idx], points[2 * idx + 1], cnv, mtx);
    var scalingFactor = camera.semanticZoom(sizes.length);
    // Clamp like in pointculled shader
    var size = Math.max(5, Math.min(scalingFactor * sizes[idx], 50)) / pixelRatio;
    var offset = size / 2.0;

    $cont.attr('pointIdx', idx).css({
        top: pos.y,
        left: pos.x
    });
    $point.css({
        'left' : -offset,
        'top' : -offset,
        'width': size,
        'height': size,
        'border-radius': size / 2
    });

    /* Ideally, highlighted-point-center would be a child of highlighted-point-cont
    * instead of highlighted-point. I ran into tricky CSS absolute positioning
    * issues when I tried that. */
    var csize = parseInt($center.css('width'), 10);
    $center.css({
        'left' : offset - csize / 2.0,
        'top' : offset - csize / 2.0
    });
}


function newLabelPositions(renderState, labels, points) {

    var camera = renderState.get('camera');
    var cnv = renderState.get('canvas');
    var mtx = camera.getMatrix();

    var newPos = new Float32Array(labels.length * 2);
    for (var i = 0; i < labels.length; i++) {
        // TODO: Treat 2D labels more naturally.
        var dim = labels[i].dim;
        if (dim === 2) {
            newPos[2 * i] = -1;
            newPos[2 * i + 1] = -1;
        } else {
            var idx = labels[i].idx;
            var pos = camera.canvasCoords(points[2 * idx], points[2 * idx + 1], cnv, mtx);
            newPos[2 * i] = pos.x;
            newPos[2 * i + 1] = pos.y;
        }
    }

    return newPos;
}

function effectLabels(toClear, toShow, labels, newPos, highlighted, clicked, poi) {

    //DOM effects: disable old, then move->enable new
    toClear.forEach(function (lbl) {
        lbl.elt.css('display','none');
    });

    labels.forEach(function (elt, i) {
        // TODO: Deal with 2D elements cleaner
        if (elt.dim === 2) {
            elt.elt.css('left', mousePosition.x).css('top', mousePosition.y);
        } else {
            elt.elt.css('left', newPos[2 * i]).css('top', newPos[2 * i + 1]);
        }
        elt.elt.removeClass('on');
        elt.elt.removeClass('clicked');
    });

    highlighted.forEach(function (label) {
        var cacheKey = poi.cacheKey(label.idx, label.dim);
        if (label.idx > -1) {
            poi.state.activeLabels[cacheKey].elt.toggleClass('on', true);
        }
    });

    clicked.forEach(function (clickObj) {
        var cacheKey = poi.cacheKey(clickObj.idx, clickObj.dim);
        if (clickObj.idx > -1) {
            poi.state.activeLabels[cacheKey].elt.toggleClass('clicked', true);
        }
    });

    toShow.forEach(function (lbl) {
        lbl.elt.css('display', 'block');
    });

}

function renderLabelsImmediate (appState, $labelCont, curPoints, highlighted, clicked) {

    var poi = appState.poi;
    var points = new Float32Array(curPoints.buffer);

    var t0 = Date.now();

    var hits = poi.getActiveApprox(appState.renderState, 'pointHitmapDownsampled');
    highlighted.forEach(function (labelObj) {
        var labelIdx = labelObj.idx;
        if (labelIdx > -1) {
            hits[poi.cacheKey(labelIdx, labelObj.dim)] = {
                dim: labelObj.dim,
                idx: labelIdx
            };
        }
    });
    var t1 = Date.now();

    var toClear = poi.finishApprox(poi.state.activeLabels, poi.state.inactiveLabels,
                                   hits, appState.renderState, points);

    //select label elts (and make active if needed)
    var toShow = [];
    var labels = _.values(hits)
        .map(function (hit) {

            var idx = parseInt(hit.idx);
            var dim = hit.dim;

            if (idx === -1) {
                return null;
            } else if (poi.state.activeLabels[poi.cacheKey(idx, dim)]) {
                //label already on, resuse
                var alreadyActiveLabel = poi.state.activeLabels[poi.cacheKey(idx, dim)];
                toShow.push(alreadyActiveLabel);
                return alreadyActiveLabel;
            } else if ((_.keys(poi.state.activeLabels).length > poi.MAX_LABELS) && (_.pluck(highlighted, 'idx').indexOf(idx) === -1)) {
                //no label but too many on screen, don't create new
                return null;
            } else if (!poi.state.inactiveLabels.length) {
                //no label and no preallocated elts, create new
                var freshLabel = poi.genLabel($labelCont, idx, hits[poi.cacheKey(idx, dim)]);
                freshLabel.elt.on('mouseover', function () {
                    appState.labelHover.onNext(this);
                });
                toShow.push(freshLabel);
                return freshLabel;
            } else {
                //no label and available inactive preallocated, reuse
                var lbl = poi.state.inactiveLabels.pop();
                lbl.idx = idx;
                lbl.dim = dim;
                lbl.setIdx({idx: idx, dim: lbl.dim});
                toShow.push(lbl);
                return lbl;
            }
        })
        .filter(_.identity);

    poi.resetActiveLabels(_.object(labels.map(function (lbl) { return [poi.cacheKey(lbl.idx, lbl.dim), lbl]; })));

    var t2 = Date.now();

    var newPos = newLabelPositions(appState.renderState, labels, points, toClear, toShow);

    var t3 = Date.now();

    effectLabels(toClear, toShow, labels, newPos, highlighted, clicked, poi);

    debug('sampling timing', t1 - t0, t2 - t1, t3 - t2, Date.now() - t3,
        'labels:', labels.length, '/', _.keys(hits).length, poi.state.inactiveLabels.length);
}

//move labels when new highlight or finish noisy rendering section
// AppState * $DOM * Observable [ {dim: int, idx: int} ] * Observable DOM -> ()
function setupLabels (appState, $eventTarget, latestHighlightedObject) {
    var $labelCont = $('<div>').addClass('graph-label-container');
    $eventTarget.append($labelCont);
    var $sim = $('#simulation');

    appState.cameraChanges.combineLatest(
        appState.vboUpdates,
        _.identity
    ).flatMapLatest(function () {
        return latestHighlightedObject;
    }).do(function (highlighted) {
        if ($sim.hasClass('moving')) {
            renderPointLabels(appState, $labelCont, [], []);
        } else {

            // var indices = highlighted.map(function (o) {
            //     return !o.dim || o.dim === 1 ? o.idx : -1;
            // });

            var clicked = highlighted.filter(function (o) {
                return o.click;
            });

            renderPointLabels(appState, $labelCont, highlighted, clicked);
        }
    })
    .subscribe(_.identity, util.makeErrorHandler('setuplabels'));
}

//AppState * $DOM * textureName-> Observable [ {dim: 1, idx: int} ]
//Changes either from point mouseover or a label mouseover
//Clicking (coexists with hovering) will open at most 1 label
//Most recent interaction goes at the end
function getLatestHighlightedObject (appState, $eventTarget, textures) {

    var OFF = [{idx: -1, dim: 0}];
    var $cont = $('#highlighted-point-cont');
    var res = new Rx.ReplaySubject(1);
    res.onNext(OFF);

    interaction.setupMousemove($eventTarget).combineLatest(
            appState.hitmapUpdates,
            _.identity
        )
        .map(function (pos) {
            return picking.hitTestN(appState.renderState, textures, pos.x, pos.y, 10);
        })
        // TODO: Make sure this also catches $('#marquee').hasClass('done') and 'beingdragged'
        // As a non-marquee-active state.
        // .flatMapLatest(util.observableFilter(appState.marqueeActive, util.notIdentity))
        .flatMapLatest(util.observableFilter([appState.marqueeOn, appState.brushOn],
                function (v) {
                    return (v !== 'selecting') && (v !== 'dragging');
                },
                util.AND
        ))
        .map(function (v) { return {cmd: 'hover', pt: v}; })
        .merge($eventTarget.mousedownAsObservable()
            .flatMapLatest(util.observableFilter(appState.anyMarqueeOn, util.notIdentity))
            .map(function (evt) {
                var clickedLabel = $(evt.target).hasClass('graph-label') ||
                        $(evt.target).hasClass('highlighted-point') ||
                        $(evt.target).hasClass('highlighted-point-center');
                if (!clickedLabel) {
                    clickedLabel = $(evt.target).parents('.graph-label').length || false;
                }
                return clickedLabel ?
                    {cmd: 'click', pt: {dim: 1, idx: parseInt($cont.attr('pointidx'))}}
                    : {cmd: 'declick'};
            }))
        .merge(
            appState.labelHover
                .flatMapLatest(util.observableFilter(appState.anyMarqueeOn, util.notIdentity))
                .map(function (elt) {
                    return _.values(appState.poi.state.activeLabels)
                        .filter(function (lbl) { return lbl.elt.get(0) === elt; });
                })
                .filter(function (highlightedLabels) { return highlightedLabels.length; })
                // TODO: Tag this as a point properly
                .map(function (highlightedLabels) {
                    return {cmd: 'hover', pt: {dim: 1, idx: highlightedLabels[0].idx}};
                }))
        .scan([], function (acc, cmd) {
            switch (cmd.cmd) {
                case 'hover':
                    return acc
                        .filter(function (pt) { return !pt.hover; })
                        .concat(_.extend({hover: true}, cmd.pt));
                case 'click':
                    return acc
                        .filter(function (pt) { return !pt.click; })
                        .concat(_.extend({click: true}, cmd.pt));
                case 'declick':
                    return [];
            }
        })
        .map(function (arr) {
            return arr.filter(function (v) { return v.idx !== -1; });
        })
        .map(function (arr) {
            return arr.length ? arr : OFF;
        })
        .subscribe(res, util.makeErrorHandler('getLatestHighlightedObject'));

    return res;
}


module.exports = {
    setupLabels: setupLabels,
    setupCursor: setupCursor,
    getLatestHighlightedObject: getLatestHighlightedObject
};
