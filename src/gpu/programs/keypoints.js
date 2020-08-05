/*
 * speedy-vision.js
 * GPU-accelerated Computer Vision for the web
 * Copyright 2020 Alexandre Martins <alemartf(at)gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * gpu-keypoints.js
 * Facade for various keypoint detection algorithms
 */

import { GPUProgramGroup } from '../gpu-program-group';
import { importShader } from '../shader-declaration';



//
// FAST corner detector
//

// FAST-9_16: requires 9 contiguous pixels
// on a circumference of 16 pixels
const fast9 = importShader('keypoints/fast9lg.glsl').withArguments('image', 'threshold');

// FAST-9_16 on scale-space
// Requires image mipmap
const fast9pyr = importShader('keypoints/fast9pyr.glsl').withArguments('pyramid', 'threshold', 'minLod', 'maxLod', 'usePyrSubLevels');

// FAST-7_12: requires 7 contiguous pixels
// on a circumference of 12 pixels
const fast7 = importShader('keypoints/fast7.glsl').withArguments('image', 'threshold');

// FAST-5_8: requires 5 contiguous pixels
// on a circumference of 8 pixels
const fast5 = importShader('keypoints/fast5.glsl').withArguments('image', 'threshold');

// compute corner score considering a
// neighboring circumference of 16 pixels
const fastScore16 = importShader('keypoints/fast-score16.glsl').withArguments('image', 'threshold');

// compute corner score considering a
// neighboring circumference of 12 pixels
const fastScore12 = importShader('keypoints/fast-score12.glsl').withArguments('image', 'threshold');

// compute corner score considering a
// neighboring circumference of 8 pixels
const fastScore8 = importShader('keypoints/fast-score8.glsl').withArguments('image', 'threshold');



//
// Harris-Shi-Tomasi corner detector
//

// compute corner responses (score map)
const multiscaleHarris = importShader('keypoints/multiscale-harris.glsl').withArguments('pyramid', 'windowRadius', 'minLod', 'maxLod', 'usePyrSubLevels', 'sobelDerivatives');

// discard corners below a specified quality level
const harrisCutoff = importShader('keypoints/harris-cutoff.glsl').withArguments('corners', 'maxScore', 'quality');


//
// BRISK feature detection
//
const brisk = importShader('keypoints/brisk.glsl').withArguments('image', 'layerA', 'layerB', 'scaleA', 'scaleB', 'lgM', 'h');



//
// Generic keypoint routines
//

// non-maximum suppression
const nonmaxSuppression = importShader('keypoints/nonmax-suppression.glsl').withArguments('image');
const multiscaleSuppression = importShader('keypoints/multiscale-suppression.glsl').withArguments('image', 'usePyrSubLevels');
const samescaleSuppression = importShader('keypoints/samescale-suppression.glsl').withArguments('image');

// find keypoint orientation
const orientationViaCentroid = importShader('keypoints/orientation-via-centroid.glsl').withArguments('corners', 'patchRadius');
const multiscaleOrientationViaCentroid = importShader('keypoints/multiscale-orientation-via-centroid.glsl').withArguments('corners', 'patchRadius', 'pyramid');

// Sobel derivatives
const multiscaleSobel = importShader('keypoints/multiscale-sobel.glsl').withArguments('pyramid', 'lod');




/**
 * GPUKeypoints
 * Keypoint detection
 */
export class GPUKeypoints extends GPUProgramGroup
{
    /**
     * Class constructor
     * @param {SpeedyGPU} gpu
     * @param {number} width
     * @param {number} height
     */
    constructor(gpu, width, height)
    {
        super(gpu, width, height);
        this
            // FAST-9,16
            .compose('fast9', '_fast9', '_fastScore16')
            .declare('_fast9', fast9) // find corners
            .declare('_fastScore16', fastScore16) // compute scores

            // FAST-7,12
            .compose('fast7', '_fast7', '_fastScore12')
            .declare('_fast7', fast7)
            .declare('_fastScore12', fastScore12)

            // FAST-5,8
            .compose('fast5', '_fast5', '_fastScore8')
            .declare('_fast5', fast5)
            .declare('_fastScore8', fastScore8)

            // FAST-9,16 plus
            .declare('fast9pyr', fast9pyr)

            // BRISK Scale-Space Non-Maximum Suppression & Interpolation
            .declare('brisk', brisk)

            // Harris-Shi-Tomasi corner detector
            .declare('multiscaleHarris', multiscaleHarris) // scale-space
            .declare('harrisCutoff', harrisCutoff)

            // Generic non-maximum suppression
            .declare('nonmaxSuppression', nonmaxSuppression)
            .declare('multiscaleSuppression', multiscaleSuppression) // scale-space
            .declare('samescaleSuppression', samescaleSuppression) // scale-space

            // Generic orientation finder
            .declare('orientationViaCentroid', orientationViaCentroid)
            .declare('multiscaleOrientationViaCentroid', multiscaleOrientationViaCentroid) // scale-space

            // Sobel derivatives
            .declare('multiscaleSobel', multiscaleSobel, {
                ...this.program.doesNotRecycleTextures()
            }) // scale-space
        ;
    }
}

