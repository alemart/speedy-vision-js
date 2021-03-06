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
 * speedy-texture-reader.js
 * Reads data from textures
 */

import { Utils } from '../utils/utils';
import { GLUtils } from './gl-utils';
import { SpeedyPromise } from '../utils/speedy-promise';
import { SpeedyDrawableTexture } from './speedy-texture';
import { IllegalArgumentError, IllegalOperationError } from '../utils/errors';

// number of pixel buffer objects
// used to get a performance boost in gl.readPixels()
// (1 seems to perform better on mobile, 2 on the PC?)
const DEFAULT_NUMBER_OF_BUFFERS = 1; //2;


/**
 * Reads data from textures
 */
export class SpeedyTextureReader
{
    /**
     * Constructor
     * @param {number} [numberOfBuffers]
     */
    constructor(numberOfBuffers = DEFAULT_NUMBER_OF_BUFFERS)
    {
        Utils.assert(numberOfBuffers > 0);

        /** @type {Uint8Array[]} pixel buffers for data transfers (each stores RGBA data) */
        this._pixelBuffer = (new Array(numberOfBuffers)).fill(null).map(() => new Uint8Array(0));

        /** @type {number[]} for async data transfers (stores buffer indices) */
        this._consumerQueue = (new Array(numberOfBuffers)).fill(0).map((_, i) => i);

        /** @type {number[]} for async data transfers (stores buffer indices) */
        this._producerQueue = [];
    }

    /**
     * Read pixels from a texture, synchronously.
     * You may optionally specify a (x,y,width,height) sub-rectangle.
     * @param {SpeedyDrawableTexture} texture a texture with a FBO
     * @param {number} [x]
     * @param {number} [y] 
     * @param {number} [width]
     * @param {number} [height]
     * @returns {Uint8Array} pixels in the RGBA format
     */
    readPixelsSync(texture, x = 0, y = 0, width = texture.width, height = texture.height)
    {
        const gl = texture.gl;
        const fbo = texture.glFbo;

        // clamp values
        width = Math.max(0, Math.min(width, texture.width));
        height = Math.max(0, Math.min(height, texture.height));
        x = Math.max(0, Math.min(x, texture.width - width));
        y = Math.max(0, Math.min(y, texture.height - height));

        // buffer allocation
        const sizeofBuffer = width * height * 4; // 4 bytes per pixel (RGBA)
        this._reallocate(sizeofBuffer);

        // lost context?
        if(gl.isContextLost())
            return this._pixelBuffer[0].subarray(0, sizeofBuffer);

        // read pixels
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this._pixelBuffer[0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // done!
        return this._pixelBuffer[0].subarray(0, sizeofBuffer);
    }

    /**
     * Read pixels from a texture, asynchronously, with PBOs.
     * You may optionally specify a (x,y,width,height) sub-rectangle.
     * @param {SpeedyDrawableTexture} texture a texture with a FBO
     * @param {boolean} [useBufferedDownloads] accelerate downloads by returning pixels from the texture of the previous call (useful for streaming)
     * @param {number} [x]
     * @param {number} [y] 
     * @param {number} [width]
     * @param {number} [height]
     * @returns {SpeedyPromise<Uint8Array>} resolves to an array of pixels in the RGBA format
     */
    readPixelsAsync(texture, useBufferedDownloads = false, x = 0, y = 0, width = texture.width, height = texture.height)
    {
        const gl = texture.gl;
        const fbo = texture.glFbo;

        // clamp values
        width = Math.max(0, Math.min(width, texture.width));
        height = Math.max(0, Math.min(height, texture.height));
        x = Math.max(0, Math.min(x, texture.width - width));
        y = Math.max(0, Math.min(y, texture.height - height));

        // buffer allocation
        const sizeofBuffer = width * height * 4; // 4 bytes per pixel (RGBA)
        this._reallocate(sizeofBuffer);

        // lost context?
        if(gl.isContextLost())
            return SpeedyPromise.resolve(this._pixelBuffer[0].subarray(0, sizeofBuffer));

        // do not optimize?
        if(!useBufferedDownloads) {
            return SpeedyTextureReader._readPixelsViaPBO(gl, this._pixelBuffer[0], fbo, x, y, width, height).then(() =>
                this._pixelBuffer[0].subarray(0, sizeofBuffer)
            );
        }

        // GPU needs to produce data
        if(this._producerQueue.length > 0) {
            const nextBufferIndex = this._producerQueue.shift();
            SpeedyTextureReader._readPixelsViaPBO(gl, this._pixelBuffer[nextBufferIndex], fbo, x, y, width, height).then(() => {
                this._consumerQueue.push(nextBufferIndex);
            });
        }
        else this._waitForQueueNotEmpty(this._producerQueue).then(() => {
            const nextBufferIndex = this._producerQueue.shift();
            SpeedyTextureReader._readPixelsViaPBO(gl, this._pixelBuffer[nextBufferIndex], fbo, x, y, width, height).then(() => {
                this._consumerQueue.push(nextBufferIndex);
            });
        }).turbocharge();

        // CPU needs to consume data
        if(this._consumerQueue.length > 0) {
            const readyBufferIndex = this._consumerQueue.shift();
            return new SpeedyPromise(resolve => {
                resolve(this._pixelBuffer[readyBufferIndex].subarray(0, sizeofBuffer));
                this._producerQueue.push(readyBufferIndex); // enqueue AFTER resolve()
            });
        }
        else return new SpeedyPromise(resolve => {
            this._waitForQueueNotEmpty(this._consumerQueue).then(() => {
                const readyBufferIndex = this._consumerQueue.shift();
                resolve(this._pixelBuffer[readyBufferIndex].subarray(0, sizeofBuffer));
                this._producerQueue.push(readyBufferIndex); // enqueue AFTER resolve()
            }).turbocharge();
        });
    }

    /**
     * Reallocate the pixel buffers, so that they can hold the required number of bytes
     * If the pixel buffers already have the required capacity, then nothing is done
     * @param {number} size in bytes
     */
    _reallocate(size)
    {
        // no need to reallocate
        if(size <= this._pixelBuffer[0].byteLength)
            return;

        // reallocate
        for(let i = 0; i < this._pixelBuffer.length; i++) {
            const newBuffer = new Uint8Array(size);
            newBuffer.set(this._pixelBuffer[i]); // make this optional?
            this._pixelBuffer[i] = newBuffer;
        }
    }

    /**
     * Wait for a queue to be not empty
     * @param {Array} queue
     * @returns {SpeedyPromise<void>}
     */
    _waitForQueueNotEmpty(queue)
    {
        return new SpeedyPromise(resolve => {
            (function wait() {
                if(queue.length > 0)
                    resolve();
                else
                    setTimeout(wait, 0); // Utils.setZeroTimeout may hinder performance (GLUtils already calls it)
                    //Utils.setZeroTimeout(wait);
            })();
        });
    }

    /**
     * Read pixels to a Uint8Array, asynchronously, using a Pixel Buffer Object (PBO)
     * It's assumed that the target texture is in the RGBA8 format
     * @param {WebGL2RenderingContext} gl
     * @param {Uint8Array} outputBuffer with size >= width * height * 4
     * @param {WebGLFramebuffer} fbo
     * @param {GLint} x
     * @param {GLint} y
     * @param {GLsizei} width
     * @param {GLsizei} height
     * @returns {SpeedyPromise}
     */
    static _readPixelsViaPBO(gl, outputBuffer, fbo, x, y, width, height)
    {
        // create temp buffer
        const pbo = gl.createBuffer();

        // validate outputBuffer
        if(!(outputBuffer.byteLength >= width * height * 4))
            throw new IllegalArgumentError(`Can't read pixels: invalid buffer size`);

        // bind the PBO
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, outputBuffer.byteLength, gl.STREAM_READ);

        // read pixels into the PBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // unbind the PBO
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        // wait for DMA transfer
        return GLUtils.getBufferSubDataAsync(gl, pbo,
            gl.PIXEL_PACK_BUFFER,
            0,
            outputBuffer,
            0,
            0
        ).catch(err => {
            throw new IllegalOperationError(`Can't read pixels`, err);
        }).finally(() => {
            gl.deleteBuffer(pbo);
        });
    }
}