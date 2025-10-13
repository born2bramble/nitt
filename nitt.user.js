    // ==UserScript==
// @name         Nomi Image Tags Tools
// @namespace    https://github.com/born2bramble
// @version      1.0
// @description  Add tag indicators and view tags on gallery page
// @author       born2bramble
// @homepageURL  https://github.com/born2bramble/nitt
// @match        https://beta.nomi.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nomi.ai
// @grant        none
// @run-at       document-idle
// @downloadURL  https://github.com/born2bramble/nitt/raw/refs/heads/main/nitt.user.js
// @updateURL    https://github.com/born2bramble/nitt/raw/refs/heads/main/nitt.user.js

// ==/UserScript==

(function() {
    'use strict';
    let idPattern = /(?<=images\/).*(?=\.webp)|(?<=image-edit-requests\/).*(?=\/edited-image)|(?<=video-requests\/).*(?=\/preview)/;

    const viewCheck = {
        album: new RegExp('\/(photo-album)'),
        isAlbum: function(url) {
            return this.album.test(url)
        }
    }

    if (viewCheck.isAlbum(document.URL)) {
        executeScript(document.URL);
    }

    window.navigation.addEventListener("navigate", (event) => {
        if (viewCheck.isAlbum(event.destination.url)) {
            executeScript(event.destination.url);
        }
    })

    function executeScript(url) {
        function checkIfLoaded(){
            let imgs = getImages();
            if (!imgs) return;
            if (window.getComputedStyle(imgs[imgs.length - 1]).background.match(/url\(".*\/api\//)) {
                addCss();
                intersectionObserverSetup(imgs);
                clearInterval(intervalId);
                clearTimeout(timeoutId);
            }
        }

        const intervalId = setInterval(checkIfLoaded, 100);
        const timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            console.warn("Stopped polling after timeout");
        }, 10000);
    }

    function getImages(){
        let images = [...document.querySelectorAll('[aria-label^="Photo Number "] > div > div:first-child')];
        if (images.length == 0) return;
        return images
    }

    async function getTags(imageId, mediaType) {
        const res = await fetch(`https://beta.nomi.ai/api/${mediaType}/${imageId}/tags`);
        if (!res.ok) throw new Error(`Failed ${res.status}. mediaType: ${mediaType}, imageID: ${imageId}`);
        return res.json();
    }


    function intersectionObserverSetup(imgs){

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const index = imgs.indexOf(el);
                    const bgValue = window.getComputedStyle(el).background
                    const id = el.dataset.imageId == "null" ? bgValue.match(idPattern) : el.dataset.imageId;

                    let mediaType;
                    if (/image-edit-requests/.test(bgValue)) {
                        mediaType = "image-edit-requests"
                    } else if (/video-requests/.test(bgValue)) {
                        mediaType = "video-requests"
                    } else {
                        mediaType = "selfie-images"
                    }

                    getTags(id, mediaType).then(results => {
                        let tags = results.tags;
                        if (tags.length == 0) return;

                        let tagNames = tags.map(tagObj => tagObj.name);
                        addTagIndicator(el, index, tagNames);
                    });
                    observer.unobserve(el); // only once
                }
            });
        }, {scrollMargin: "200px"});

        imgs.forEach((el) => {
            el.dataset.imageId = window.getComputedStyle(el).background.match(idPattern);
            observer.observe(el);
        });
    }

    function addTagIndicator(el, i, tags) {
        if (el.querySelector('.nitt__tag-preview')) return;

        let tagEl = document.createElement('div');
        tagEl.setAttribute('class', 'nitt__tag-preview');
        let tagUI = `
            <input type="checkbox" id="nitt__toggle${i+1}" name="Image tags">
            <label for="nitt__toggle${i+1}">
                <span>🏷️</span>
            </label>
            <div class="nitt__show-tags">
                <ul class="nitt__tag-list">
                    <li>${tags.join('</li><li>')}</li>
                </ul>
            </div>
        `
        el.append(tagEl);
        tagEl.insertAdjacentHTML("beforeend", tagUI);

        /* Prevent click on tag icon from opening image view */
        tagEl.addEventListener("click", (evt) => {
            evt.stopPropagation();
        })
    }

    function addCss(styles) {
        if (document.querySelector('style#nitt__styles')) return;

        const newStyles = document.createElement("style")
        newStyles.setAttribute('id', 'nitt__styles');
        newStyles.innerHTML = `
            [aria-label="Photo Number 1, Profile Picture"] .nitt__tag-preview {
                z-index: 2;
            }
            
            :where(.nitt__tag-preview) {
                --icon-bg:  var(--mantine-color-dark-filled, #3a3838);
                --icon-color: var(--mantine-color-purple-light-color, #cb48ff);
                --icon-bg--active: var(--icon-color);
                --icon-color--active: var(--icon-bg);
                
                position:absolute;
                max-width: 100%;
                bottom: 0;
                right: 0;
                z-index: 0;

                input {
                    /* remove the checkbox from flow */
                    position: absolute;
                    z-index:0;
                    
                    /* hide it visually */
                    opacity: 0;
                    
                    /* position with label (not really necessary but feels neater) */
                    bottom: 0;
                    right: 0;
                }
                
                label {
                    position: absolute;
                    z-index: 1;
                    bottom: 0;
                    right: 0;
                    display: grid;
                    align-content: center;
                    max-width: fit-content;
                    aspect-ratio: 1;
                    margin: 3px 2px;
                    border: 1px solid #5c5c5c9c;
                    border-radius: 50%;
                    background: var(--icon-bg);
                    font-size: 1rem;
                    line-height: 1;

                    span {
                        color: transparent;
                        background: var(--icon-color);
                        -webkit-background-clip: text;
                        background-clip: text;
                    }
                }
                
                /* Invert colours when tag display toggled on */
                :where(input:checked) + label {
                    border-color: #453650b5;
                    background: var(--icon-bg--active);
                    
                    span {
                        background: var(--icon-color--active);
                        color: transparent;
                        -webkit-background-clip: text;
                        background-clip: text;
                    }
                }
                
                /* basic focus styles */
                :where(input:focus-visible) + label {
                    outline: 5px auto Highlight;
                    outline: 5px auto -webkit-focus-ring-color;
                    outline-offset: 1px;
                }
                
                .nitt__show-tags {
                    /* Hidden by default */
                    display: none;
                    
                    position: relative;
                    width: 20rem;
                    max-width: 100%;
                    margin: 0;
                    padding: 5px 4px 4px;
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                    border: 1px solid rgb(113 113 113 / 80%);
                    border-radius: 0 0 5px 5px; /* matches border-radius on images */
                    background: rgba(132, 132, 132, 0.6);
                    backdrop-filter: blur(9px);
                    -webkit-backdrop-filter: blur(9px);
                }
                
                .nitt__tag-list {
                    list-style: none;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    margin: 0;
                    padding: 0;
                    color: black;
                    
                    /* individual tag styles */
                    :where(&) li {
                        padding: 3px;
                        border: 1px solid #ffffff63;
                        border-radius: 5px;
                        background: #ffffffb0;
                        font-size: .8rem;
                        line-height: 1;
                        font-weight: 500;
                        
                        &:last-child {
                            margin-inline-end: 1.4rem;
                        }
                    }
                }
                
                /* Show tags on hover and click toggle */
                :where(input:checked + label, input:hover + label, label:hover) + .nitt__show-tags {
                    display: block;
                }
            }
        `
        document.body.insertAdjacentElement("afterBegin", newStyles)
    }

})();
