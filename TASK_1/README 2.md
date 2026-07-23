# Image Pixel Analysis

## Task

The purpose of this task was to understand how images are represented using pixel values and to compare an original image with its screenshot.

## Steps Performed

1. Loaded a colourful image using Pillow.
2. Displayed the original image.
3. Converted the image to grayscale.
4. Converted the grayscale image into a NumPy array.
5. Displayed a small region of the image with its pixel values.
6. Took a screenshot of the original image.
7. Converted the screenshot to grayscale.
8. Displayed the screenshot pixel values.
9. Compared the pixel values of both images.

## Tools Used

* Python
* Jupyter Notebook
* Pillow
* NumPy
* Matplotlib

## Conclusion

The pixel values of the screenshot were different from the pixel values of the original image. This happens because taking a screenshot may resize, compress, or process the image.

Pixel comparison can show that two images are different, but it cannot alone prove that an image is fake. Other information, such as metadata, image dimensions, and compression patterns, may also be required.
