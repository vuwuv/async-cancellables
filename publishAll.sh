#!/bin/bash

read -p "Would you like to publish all the packages? [y/N] " choice
if [ "$choice" == "y" ] || [ "$choice" == "Y" ]; then
    for dir in packages/*; do
        if [ -d "$dir" ]; then
            (cd "$dir" && npm publish --access=public)
        fi
    done
fi
