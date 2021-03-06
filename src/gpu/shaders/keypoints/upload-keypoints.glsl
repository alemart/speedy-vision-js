/*
 * speedy-vision.js
 * GPU-accelerated Computer Vision for JavaScript
 * Copyright 2020-2021 Alexandre Martins <alemartf(at)gmail.com>
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
 * upload-keypoints.glsl
 * Upload keypoints to the GPU using a Uniform Buffer Object
 */

@include "keypoints.glsl"

uniform sampler2D encodedKeypoints;
uniform int startIndex; // multipass. Start index, inclusive. Defaults to 0
uniform int endIndex; // multipass. End index, exclusive
uniform int descriptorSize; // in bytes
uniform int extraSize; // in bytes
uniform int encoderLength;

#ifndef BUFFER_SIZE
#error Undefined BUFFER_SIZE
#endif

layout(std140) uniform KeypointBuffer
{
    // tightly packed (16 bytes)
    vec4 keypointBuffer[BUFFER_SIZE]; // xpos, ypos, lod, score
};

void main()
{
    vec4 pixel = threadPixel(encodedKeypoints);
    ivec2 thread = threadLocation();
    KeypointAddress address = findKeypointAddress(thread, encoderLength, descriptorSize, extraSize);
    int index = findKeypointIndex(address, descriptorSize, extraSize);

    // multipass: keep previous results
    color = pixel;
    if(index < startIndex)
        return;

    // multipass: await future results
    color = encodeNullKeypoint(); // end of list
    if(index >= endIndex)
        return;
    
    // encode keypoint data
    vec4 data = keypointBuffer[index - startIndex];
    switch(address.offset) {
        case 0: {
            // keypoint position
            fixed2_t pos = vec2tofix(data.xy);
            fixed2_t lo = pos & 255;
            fixed2_t hi = (pos >> 8) & 255;
            color = vec4(float(lo.x), float(hi.x), float(lo.y), float(hi.y)) / 255.0f;
            break;
        }

        case 1: {
            // keypoint score & scale
            float score = clamp(data.w, 0.0f, 1.0f);
            float scale = encodeLod(data.z);
            float rotation = encodeOrientation(0.0f);
            float flags = encodeKeypointFlags(KPF_NONE);
            color = vec4(scale, rotation, score, flags);
            break;
        }

        default: {
            // keypoint descriptor or extra data
            color = vec4(0.0f);
            break;
        }
    }
}